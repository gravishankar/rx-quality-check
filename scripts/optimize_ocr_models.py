#!/usr/bin/env python3
"""
Shrink the on-device OCR models (Task 4C build 8). Deterministic: the same inputs and the pinned
`onnx`/`numpy` versions give byte-identical outputs, whose SHA-256s are pinned in
scripts/fetch_ocr_models.sh.

1. Recognition model: keep only the output classes the app can use on US labels (blank, printable
   ASCII, a few label symbols, space). The final linear layer goes from 6,625 classes to about 100;
   the kept classes' scores are unchanged, so the model reads those characters exactly as before.
   The embedded character list (metadata key "character") is rewritten to match.
2. Weight-only 8-bit quantization, per output channel, for Conv/MatMul weights: every weight of
   1,024+ elements in the detector; only the 3 largest layers (200,000+ elements) in the recognizer,
   because quantizing all of it dropped a letter on the owner's real vial photo ("ALODIPINE"). Each
   weight is stored as int8 plus a float scale and rebuilt by Cast + Mul (valid in the models' opset
   12; ONNX Runtime folds these constants at load), so the network still computes in float; only the
   stored weights are rounded (accuracy re-measured in docs/task4c/OCR_EVALUATION.md).

  python3 scripts/optimize_ocr_models.py <det_in> <rec_in> <det_out> <rec_out>
"""
import sys

import numpy as np
import onnx
from onnx import helper, numpy_helper

# Characters kept by the recognizer: printable ASCII (space is the model's separate last class) and
# symbols seen on US drug labels. NFKC normalization in the app maps full-width forms to these anyway.
EXTRA = ["®", "™", "°", "µ", "μ", "±", "×", "·", "’", "“", "”", "–", "—"]
KEEP = [chr(c) for c in range(33, 127)] + EXTRA
DET_MIN_ELEMENTS = 1024  # small tensors (biases, norms, tiny kernels) stay float
REC_MIN_ELEMENTS = 200_000


def constants(model):
    """Map output name -> Constant node for weight constants (paddle2onnx stores weights this way)."""
    out = {}
    for n in model.graph.node:
        if n.op_type == "Constant" and any(a.name == "value" for a in n.attribute):
            out[n.output[0]] = n
    return out


def value_of(node):
    return numpy_helper.to_array(next(a.t for a in node.attribute if a.name == "value"))


def set_value(node, arr, name):
    for a in node.attribute:
        if a.name == "value":
            a.t.CopyFrom(numpy_helper.from_array(arr, name))


def prune_classes(model):
    meta = {p.key: p.value for p in model.metadata_props}
    chars = [c for c in meta["character"].split("\n") if c != ""]
    index = {c: i for i, c in enumerate(chars)}
    kept = [c for c in KEEP if c in index]
    # Class 0 = CTC blank; class i+1 = chars[i]; last class = space.
    cols = [0] + [index[c] + 1 for c in kept] + [len(chars) + 1]
    last = [n for n in model.graph.node if n.op_type == "MatMul"][-1]
    add = next(n for n in model.graph.node if n.op_type == "Add" and n.input[0] == last.output[0])
    consts = constants(model)
    w_node, b_node = consts[last.input[1]], consts[add.input[1]]
    w, b = value_of(w_node), value_of(b_node)
    assert w.shape[1] == len(chars) + 2 and b.shape[0] == len(chars) + 2, (w.shape, b.shape, len(chars))
    set_value(w_node, np.ascontiguousarray(w[:, cols]), last.input[1])
    set_value(b_node, np.ascontiguousarray(b[cols]), add.input[1])
    for p in model.metadata_props:
        if p.key == "character":
            p.value = "\n".join(kept)
    # The declared output shape's class dimension, if static, must follow.
    for o in model.graph.output:
        dims = o.type.tensor_type.shape.dim
        if dims and dims[-1].HasField("dim_value"):
            dims[-1].dim_value = len(cols)
    return len(chars), len(kept)


def quantize_weights(model, min_elements):
    """Weight-only int8 (symmetric, per output channel) for Conv and MatMul weights."""
    consts = constants(model)
    users = {}
    for n in model.graph.node:
        if n.op_type in ("Conv", "ConvTranspose", "MatMul") and len(n.input) > 1:
            users.setdefault(n.input[1], []).append(n)
    new_nodes, removed, count = [], set(), 0
    for name, ops in sorted(users.items()):
        node = consts.get(name)
        if node is None:
            continue
        w = value_of(node)
        if w.dtype != np.float32 or w.size < min_elements:
            continue
        kinds = {o.op_type for o in ops}
        if len(kinds) != 1:
            continue
        kind = kinds.pop()
        # Output channel axis: Conv weight [out, in, kh, kw] -> 0; ConvTranspose [in, out, ...] -> 1;
        # MatMul weight [in, out] -> 1.
        axis = 0 if kind == "Conv" else 1
        red = tuple(i for i in range(w.ndim) if i != axis)
        scale = np.abs(w).max(axis=red) / 127.0
        scale = np.where(scale == 0, np.float32(1.0), scale).astype(np.float32)
        shape = [1] * w.ndim
        shape[axis] = -1
        q = np.clip(np.round(w / scale.reshape(shape)), -127, 127).astype(np.int8)
        removed.add(id(node))
        qn, fn, sn = f"{name}__q", f"{name}__qf", f"{name}__scale"
        new_nodes.append(helper.make_node("Constant", [], [qn], value=numpy_helper.from_array(q, qn)))
        new_nodes.append(helper.make_node("Constant", [], [sn], value=numpy_helper.from_array(scale.reshape(shape), sn)))
        new_nodes.append(helper.make_node("Cast", [qn], [fn], to=onnx.TensorProto.FLOAT))
        new_nodes.append(helper.make_node("Mul", [fn, sn], [name]))
        count += 1
    kept = [n for n in model.graph.node if id(n) not in removed]
    del model.graph.node[:]
    model.graph.node.extend(new_nodes + kept)
    return count


def main(det_in, rec_in, det_out, rec_out):
    rec = onnx.load(rec_in)
    before, kept = prune_classes(rec)
    nq_rec = quantize_weights(rec, REC_MIN_ELEMENTS)
    onnx.checker.check_model(rec)
    onnx.save(rec, rec_out)
    det = onnx.load(det_in)
    nq_det = quantize_weights(det, DET_MIN_ELEMENTS)
    onnx.checker.check_model(det)
    onnx.save(det, det_out)
    print(f"recognizer: {before} -> {kept} characters, {nq_rec} weights quantized; detector: {nq_det} weights quantized")


if __name__ == "__main__":
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    main(*sys.argv[1:])
