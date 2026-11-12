/**
 * Identity confirmation. Shows where every detail came from and requires the user to confirm each
 * item separately (no "confirm all" shortcut). Release type is asked when the label decides it.
 */
import React, { useState } from 'react';
import { COPY } from '../../src/copy/en.ts';
import type { ReleaseMechanism } from '../../src/models/identity.ts';
import type { ScreenModel } from '../../src/app/screens.ts';
import { FieldList } from '../ui/FieldList.tsx';
import { Button, Card, H1, H2, P, Tick } from '../ui/kit.tsx';
import { fieldClass, type FieldClass } from '../../src/presentation/present.ts';

const GROUPS: FieldClass[] = ['VERIFIED', 'READ_OR_ENTERED', 'NEEDS_INPUT'];

type Confirm = Extract<ScreenModel, { kind: 'CONFIRM' }>;

export function Confirm({ model, onConfirm, onEdit, busy, scanned, scanNotes, onRescan }: { model: Confirm; onConfirm: (ticked: string[], release: ReleaseMechanism | null) => void; onEdit: () => void; busy: boolean; scanned?: boolean; scanNotes?: string[]; onRescan?: () => void }) {
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [release, setRelease] = useState<ReleaseMechanism | null>(null);
  const required = model.items.filter((i) => i.key !== 'lot');
  const ready = required.every((i) => ticked[i.key]) && (!model.askRelease || release !== null);
  return (
    <>
      <H1>{COPY.confirm.title}</H1>
      {model.notice ? (
        <Card tone="CAUTION" label={COPY.confirm.ndcNotFoundTitle}>
          <P>{model.notice}</P>
        </Card>
      ) : null}
      <P>{scanned ? COPY.scan.scannedNote : COPY.confirm.intro}</P>
      {(scanNotes ?? []).map((n) => (
        <Card key={n} tone="CAUTION" label={COPY.scan.groups.NEEDS_INPUT}>
          <P>{n}</P>
        </Card>
      ))}
      {GROUPS.map((g) => {
        const fields = model.fields.filter((f) => fieldClass(f.evidence) === g);
        return fields.length === 0 ? null : (
          <React.Fragment key={g}>
            <H2>{COPY.scan.groups[g]}</H2>
            <FieldList fields={fields} />
          </React.Fragment>
        );
      })}
      {model.askRelease ? (
        <>
          <H2>{COPY.confirm.releaseQuestion}</H2>
          {(['IR', 'ER', 'DR'] as const).map((r) => (
            <Tick key={r} label={r === 'IR' ? COPY.confirm.releaseIR : r === 'ER' ? COPY.confirm.releaseER : COPY.confirm.releaseDR} value={release === r} onChange={(on) => setRelease(on ? r : null)} />
          ))}
        </>
      ) : null}
      <H2>Please confirm</H2>
      {model.items.map((i) => (
        <Tick key={i.key} label={i.text} value={!!ticked[i.key]} onChange={(on) => setTicked({ ...ticked, [i.key]: on })} />
      ))}
      {model.lot ? <P muted>{COPY.fields.lotNote}</P> : null}
      <Button title={COPY.confirm.confirmAll} disabled={!ready || busy} onPress={() => onConfirm(Object.keys(ticked).filter((k) => ticked[k]), release)} />
      {onRescan ? <Button secondary title={COPY.scan.rescan} onPress={onRescan} /> : null}
      <Button secondary title={scanned ? COPY.scan.correct : COPY.confirm.edit} onPress={onEdit} />
    </>
  );
}
