/**
 * Identity confirmation. Shows where every detail came from and requires the user to confirm each
 * item separately (no "confirm all" shortcut). Release type is asked when the label decides it.
 */
import React, { useState } from 'react';
import { COPY } from '../../src/copy/en.ts';
import type { ReleaseMechanism } from '../../src/models/identity.ts';
import type { ScreenModel } from '../../src/app/screens.ts';
import { FieldList } from '../ui/FieldList.tsx';
import { Button, H1, H2, P, Tick } from '../ui/kit.tsx';

type Confirm = Extract<ScreenModel, { kind: 'CONFIRM' }>;

export function Confirm({ model, onConfirm, onEdit, busy }: { model: Confirm; onConfirm: (ticked: string[], release: ReleaseMechanism | null) => void; onEdit: () => void; busy: boolean }) {
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [release, setRelease] = useState<ReleaseMechanism | null>(null);
  const required = model.items.filter((i) => i.key !== 'lot');
  const ready = required.every((i) => ticked[i.key]) && (!model.askRelease || release !== null);
  return (
    <>
      <H1>{COPY.confirm.title}</H1>
      <P>{COPY.confirm.intro}</P>
      <FieldList fields={model.fields} />
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
      <Button secondary title={COPY.confirm.edit} onPress={onEdit} />
    </>
  );
}
