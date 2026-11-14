/** The photo could not be read: retake, or type with whatever was read prefilled. Never a result. */
import React from 'react';
import { COPY } from '../../src/copy/en.ts';
import { PhotoGuide } from './ScanHome.tsx';
import { Button, Card, H1, P } from '../ui/kit.tsx';

/**
 * UNREADABLE: the photo gave no usable text — retaking with the photo steps may help.
 * NOT_FOUND: text was read but no drug details — the label may not show them, so typing (prefilled)
 * comes first and rescanning is secondary; no photo tips that would suggest scanning again.
 */
export function ScanProblem({ reason, detail, notice = null, kind = 'UNREADABLE', onRescan, onType }: { reason: string; detail?: string | null; notice?: string | null; kind?: 'UNREADABLE' | 'NOT_FOUND'; onRescan: () => void; onType: () => void }) {
  if (kind === 'NOT_FOUND') {
    return (
      <>
        <H1>{COPY.scan.problemTitle}</H1>
        <Card tone="NEUTRAL" label={COPY.scan.nothingChecked}>
          <P>{reason}</P>
          <P>{COPY.scan.notFoundHelp}</P>
        </Card>
        {notice ? <Card tone="CAUTION" label={COPY.scan.problemTitle}><P>{notice}</P></Card> : null}
        {detail ? <P muted>{`${COPY.scan.technical}: ${detail}`}</P> : null}
        <Button title={COPY.scan.typeInstead} onPress={onType} />
        <Button secondary title={COPY.scan.rescan} onPress={onRescan} />
      </>
    );
  }
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
