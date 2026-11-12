/** Scan-first home (Task 4C). Manual entry stays available as a fallback. */
import React from 'react';
import { COPY } from '../../src/copy/en.ts';
import { Button, H1, P } from '../ui/kit.tsx';

export function ScanHome({ onScan, onType, busy, notice }: { onScan: () => void; onType: () => void; busy: boolean; notice: string | null }) {
  return (
    <>
      <P muted>{COPY.app.name}</P>
      <H1>{COPY.scan.title}</H1>
      <P>{COPY.scan.intro}</P>
      {notice ? <P>{notice}</P> : null}
      <Button title={COPY.scan.button} onPress={onScan} disabled={busy} />
      {COPY.scan.tips.map((t) => (
        <P key={t} muted>
          • {t}
        </P>
      ))}
      <P muted>{COPY.scan.privacy}</P>
      <Button secondary title={COPY.scan.typeInstead} onPress={onType} disabled={busy} />
      <P muted>{COPY.disclaimer.notMonitoring}</P>
    </>
  );
}
