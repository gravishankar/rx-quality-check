/** Scan-first home (Task 4C). Manual entry stays available as a fallback. */
import React from 'react';
import { COPY } from '../../src/copy/en.ts';
import { Button, Card, H1, P } from '../ui/kit.tsx';

/** What to photograph (the phone's camera app shows no guidance of ours). */
export function PhotoGuide() {
  return (
    <Card tone="NEUTRAL" label={COPY.scan.howToTitle}>
      {COPY.scan.howTo.map((t, i) => (
        <P key={t}>{`${i + 1}. ${t}`}</P>
      ))}
    </Card>
  );
}

export function ScanHome({ onScan, onType, busy, notice }: { onScan: () => void; onType: () => void; busy: boolean; notice: string | null }) {
  return (
    <>
      <P muted>{COPY.app.name}</P>
      <H1>{COPY.scan.title}</H1>
      <P>{COPY.scan.intro}</P>
      {notice ? <P>{notice}</P> : null}
      <PhotoGuide />
      <Button title={COPY.scan.button} onPress={onScan} disabled={busy} />
      <P muted>{COPY.scan.privacy}</P>
      <Button secondary title={COPY.scan.typeInstead} onPress={onType} disabled={busy} />
      <P muted>{COPY.disclaimer.notMonitoring}</P>
    </>
  );
}
