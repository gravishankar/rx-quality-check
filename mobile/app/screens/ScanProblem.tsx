/** The photo could not be read: retake, or type with whatever was read prefilled. Never a result. */
import React from 'react';
import { COPY } from '../../src/copy/en.ts';
import { PhotoGuide } from './ScanHome.tsx';
import { Button, Card, H1, P } from '../ui/kit.tsx';

export function ScanProblem({ reason, detail, notice = null, onRescan, onType }: { reason: string; detail?: string | null; notice?: string | null; onRescan: () => void; onType: () => void }) {
  return (
    <>
      <H1>{COPY.scan.problemTitle}</H1>
      <Card tone="NEUTRAL" label={COPY.scan.nothingChecked}>
        <P>{reason}</P>
        <P>{COPY.scan.retryTips}</P>
      </Card>
      {notice ? <Card tone="CAUTION" label={COPY.scan.problemTitle}><P>{notice}</P></Card> : null}
      {detail ? <P muted>{`${COPY.scan.technical}: ${detail}`}</P> : null}
      <PhotoGuide />
      <Button title={COPY.scan.rescan} onPress={onRescan} />
      <Button secondary title={COPY.scan.typeInstead} onPress={onType} />
    </>
  );
}
