/** Errors and recovery: nothing was checked, never a "no match". */
import React from 'react';
import { COPY } from '../../src/copy/en.ts';
import { Button, Card, H1, P } from '../ui/kit.tsx';

export function Problem({ headline, body, onRetry, onDone }: { headline: string; body: string; onRetry: (() => void) | null; onDone: () => void }) {
  return (
    <>
      <H1>{headline}</H1>
      <Card tone="NEUTRAL" label={COPY.scan.nothingChecked}>
        <P>{body}</P>
      </Card>
      <P>{COPY.disclaimer.standing}</P>
      {onRetry ? <Button title={COPY.errors.retry} onPress={onRetry} /> : null}
      <Button secondary title="Start over" onPress={onDone} />
    </>
  );
}
