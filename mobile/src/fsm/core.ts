/**
 * Minimal, dependency-free state-machine core: declarative transition rules, mandatory gates, static
 * validation and a run-until-idle loop. It knows nothing about medications, recalls or this app, so
 * it can be reused by any TypeScript application.
 *
 * Model
 *  - A state is `{ name, ctx }`. Events and effects are plain objects with a `type`.
 *  - A rule says: in states `from`, on events `on`, if `guard` holds, `apply` returns the next state
 *    and effects. `to` and `emits` declare every state and effect type the rule may produce; the
 *    core rejects anything undeclared, so the declared graph is always truthful.
 *  - Rules are tried in array order; the first matching rule wins. No match → the event is ignored
 *    (state unchanged, `ignored: true`).
 *  - Gates run after every rule and can veto the transition. Gates are supplied separately from the
 *    rules, so editing, reordering or replacing rules cannot remove them.
 *
 * The step function is pure: (state, event) → result. Effects are descriptors executed elsewhere.
 */

export interface FsmEvent {
  readonly type: string;
}

export interface FsmEffect {
  readonly type: string;
}

export interface FsmState<S extends string, C> {
  readonly name: S;
  readonly ctx: C;
}

export interface Outcome<S extends string, C, F extends FsmEffect> {
  name: S;
  ctx: C;
  effects?: F[];
}

export interface TransitionRule<S extends string, C, E extends FsmEvent, F extends FsmEffect> {
  /** Unique, stable identifier used to replace or remove the rule. */
  id: string;
  from: readonly S[];
  on: readonly E['type'][];
  /** Every state `apply` may return. */
  to: readonly S[];
  /** Every effect type `apply` may emit. Default: none. */
  emits?: readonly F['type'][];
  // Method syntax (not arrow properties) keeps callbacks bivariant, so rules written for a base
  // workflow can be reused in a variant with extra states or events.
  /** Selection guard: when false, the next rule is tried. */
  guard?(state: FsmState<S, C>, event: E): boolean;
  /** Compute the next state. Return null to treat the event as not applicable (ignored). */
  apply(state: FsmState<S, C>, event: E): Outcome<S, C, F> | null;
  description?: string;
}

export interface GateInput<S extends string, C, E extends FsmEvent, F extends FsmEffect> {
  from: FsmState<S, C>;
  event: E;
  to: FsmState<S, C>;
  effects: readonly F[];
  ruleId: string;
}

/** A mandatory invariant. Returns null when satisfied, otherwise the reason for rejecting. */
export interface Gate<S extends string, C, E extends FsmEvent, F extends FsmEffect> {
  id: string;
  description: string;
  check(input: GateInput<S, C, E, F>): string | null;
}

export interface MachineDefinition<S extends string, C, E extends FsmEvent, F extends FsmEffect> {
  id: string;
  states: readonly S[];
  initial: () => FsmState<S, C>;
  rules: readonly TransitionRule<S, C, E, F>[];
}

export interface StepResult<S extends string, C, F extends FsmEffect> {
  state: FsmState<S, C>;
  effects: F[];
  /** No rule applied; state unchanged. */
  ignored: boolean;
  /** The rule that produced the result, if any. */
  ruleId: string | null;
  /** Set when a gate (or an undeclared target/effect) vetoed the transition; state unchanged. */
  rejectedBy: string | null;
}

export interface Machine<S extends string, C, E extends FsmEvent, F extends FsmEffect> {
  readonly definition: MachineDefinition<S, C, E, F>;
  readonly gates: readonly Gate<S, C, E, F>[];
  step(state: FsmState<S, C>, event: E): StepResult<S, C, F>;
}

export class MachineDefinitionError extends Error {
  constructor(readonly problems: string[]) {
    super(`invalid state machine definition:\n- ${problems.join('\n- ')}`);
    this.name = 'MachineDefinitionError';
  }
}

/** Structural problems in a definition (empty when valid). */
export function validateDefinition<S extends string, C, E extends FsmEvent, F extends FsmEffect>(
  def: MachineDefinition<S, C, E, F>,
): string[] {
  const problems: string[] = [];
  const states = new Set<string>(def.states);
  if (states.size !== def.states.length) problems.push('duplicate state names');
  if (!states.has(def.initial().name)) problems.push(`initial state "${def.initial().name}" is not declared`);
  const ids = new Set<string>();
  for (const r of def.rules) {
    if (ids.has(r.id)) problems.push(`duplicate rule id "${r.id}"`);
    ids.add(r.id);
    if (r.from.length === 0) problems.push(`rule "${r.id}" has no source state`);
    if (r.on.length === 0) problems.push(`rule "${r.id}" has no event`);
    if (r.to.length === 0) problems.push(`rule "${r.id}" has no target state`);
    for (const s of [...r.from, ...r.to]) if (!states.has(s)) problems.push(`rule "${r.id}" uses undeclared state "${s}"`);
  }
  return problems;
}

/** Declared transition graph: one edge per (rule, from, to). */
export function edges<S extends string, C, E extends FsmEvent, F extends FsmEffect>(
  def: MachineDefinition<S, C, E, F>,
): { from: S; to: S; on: readonly string[]; ruleId: string }[] {
  return def.rules.flatMap((r) => r.from.flatMap((from) => r.to.map((to) => ({ from, to, on: r.on, ruleId: r.id }))));
}

/** States reachable from the initial state over declared edges, optionally avoiding some states. */
export function reachable<S extends string, C, E extends FsmEvent, F extends FsmEffect>(
  def: MachineDefinition<S, C, E, F>,
  opts: { avoiding?: readonly S[] } = {},
): Set<S> {
  const avoid = new Set<S>(opts.avoiding ?? []);
  const start = def.initial().name;
  const seen = new Set<S>();
  if (avoid.has(start)) return seen;
  const queue: S[] = [start];
  const all = edges(def);
  while (queue.length > 0) {
    const s = queue.shift() as S;
    if (seen.has(s)) continue;
    seen.add(s);
    for (const e of all) if (e.from === s && !avoid.has(e.to) && !seen.has(e.to)) queue.push(e.to);
  }
  return seen;
}

/** Build a machine. Throws MachineDefinitionError when the definition is structurally invalid. */
export function createMachine<S extends string, C, E extends FsmEvent, F extends FsmEffect>(
  def: MachineDefinition<S, C, E, F>,
  opts: { gates?: readonly Gate<S, C, E, F>[] } = {},
): Machine<S, C, E, F> {
  const problems = validateDefinition(def);
  if (problems.length > 0) throw new MachineDefinitionError(problems);
  const gates = [...(opts.gates ?? [])];

  const step = (state: FsmState<S, C>, event: E): StepResult<S, C, F> => {
    const ignored: StepResult<S, C, F> = { state, effects: [], ignored: true, ruleId: null, rejectedBy: null };
    for (const rule of def.rules) {
      if (!rule.from.includes(state.name) || !rule.on.includes(event.type)) continue;
      if (rule.guard && !rule.guard(state, event)) continue;
      const out = rule.apply(state, event);
      if (out === null) return { ...ignored, ruleId: rule.id };
      const effects = out.effects ?? [];
      const reject = (why: string): StepResult<S, C, F> => ({ state, effects: [], ignored: false, ruleId: rule.id, rejectedBy: why });
      if (!rule.to.includes(out.name)) return reject(`undeclared-target: rule "${rule.id}" produced "${out.name}"`);
      const allowed = rule.emits ?? [];
      const bad = effects.find((f) => !allowed.includes(f.type));
      if (bad) return reject(`undeclared-effect: rule "${rule.id}" emitted "${bad.type}"`);
      const to: FsmState<S, C> = { name: out.name, ctx: out.ctx };
      for (const g of gates) {
        const why = g.check({ from: state, event, to, effects, ruleId: rule.id });
        if (why !== null) return reject(`${g.id}: ${why}`);
      }
      return { state: to, effects, ignored: false, ruleId: rule.id, rejectedBy: null };
    }
    return ignored;
  };

  return { definition: def, gates, step };
}

// ---------------------------------------------------------------------------------------------
// Editing rule lists (for workflow variants)
// ---------------------------------------------------------------------------------------------

type AnyRule = { id: string };

function indexOfRule<R extends AnyRule>(rules: readonly R[], id: string): number {
  const i = rules.findIndex((r) => r.id === id);
  if (i < 0) throw new Error(`no rule with id "${id}"`);
  return i;
}

export function replaceRule<R extends AnyRule>(rules: readonly R[], id: string, replacement: R): R[] {
  const i = indexOfRule(rules, id);
  return [...rules.slice(0, i), replacement, ...rules.slice(i + 1)];
}

export function removeRule<R extends AnyRule>(rules: readonly R[], id: string): R[] {
  const i = indexOfRule(rules, id);
  return [...rules.slice(0, i), ...rules.slice(i + 1)];
}

/** Insert before an existing rule (it then takes precedence for the same state and event). */
export function insertBefore<R extends AnyRule>(rules: readonly R[], id: string, ...added: R[]): R[] {
  const i = indexOfRule(rules, id);
  return [...rules.slice(0, i), ...added, ...rules.slice(i)];
}

export function insertAfter<R extends AnyRule>(rules: readonly R[], id: string, ...added: R[]): R[] {
  const i = indexOfRule(rules, id);
  return [...rules.slice(0, i + 1), ...added, ...rules.slice(i + 1)];
}

// ---------------------------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------------------------

export interface RunTraceEntry {
  from: string;
  event: string;
  to: string;
  effects: string[];
  ignored: boolean;
  ruleId: string | null;
  rejectedBy: string | null;
}

/**
 * Apply an event, execute resulting effects with `execute` (which returns follow-up events), and
 * repeat until no effects remain. A rejected transition stops the run with the state unchanged.
 */
export async function runUntilIdle<S extends string, C, E extends FsmEvent, F extends FsmEffect>(
  machine: Machine<S, C, E, F>,
  state: FsmState<S, C>,
  event: E,
  execute: (effect: F) => Promise<E[]>,
  opts: { maxSteps?: number } = {},
): Promise<{ state: FsmState<S, C>; trace: RunTraceEntry[] }> {
  const trace: RunTraceEntry[] = [];
  const queue: E[] = [event];
  let s = state;
  let steps = 0;
  const max = opts.maxSteps ?? 100;
  while (queue.length > 0) {
    if (++steps > max) throw new Error('state machine did not settle');
    const e = queue.shift() as E;
    const r = machine.step(s, e);
    trace.push({
      from: s.name,
      event: e.type,
      to: r.state.name,
      effects: r.effects.map((f) => f.type),
      ignored: r.ignored,
      ruleId: r.ruleId,
      rejectedBy: r.rejectedBy,
    });
    s = r.state;
    if (r.rejectedBy !== null) break;
    for (const f of r.effects) queue.push(...(await execute(f)));
  }
  return { state: s, trace };
}
