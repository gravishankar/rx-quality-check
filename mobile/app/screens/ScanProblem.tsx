/** The photo could not be read: retake, or type with whatever was read prefilled. Never a result. */
import React from 'react';
import { COPY } from '../../src/copy/en.ts';
import { Button, Card, H1, P } from '../ui/kit.tsx';

export function ScanProblem({ reason, onRescan, onType }: { reason: string; onRescan: () => void; onType: () => void }) {
  return (
    <>
      <H1>{COPY.scan.problemTitle}</H1>
      <Card tone="NEUTRAL">
        <P>{reason}</P>
        <P>{COPY.scan.retryTips}</P>
      </Card>
      <Button title={COPY.scan.rescan} onPress={onRescan} />
      <Button secondary title={COPY.scan.typeInstead} onPress={onType} />
    </>
  );
}
