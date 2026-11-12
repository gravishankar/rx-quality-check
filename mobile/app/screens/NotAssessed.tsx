/** Excluded / unsupported / needs clarification / configuration blocked: no check was done. */
import React from 'react';
import type { NotAssessedView } from '../../src/presentation/present.ts';
import { Button, Card, H1, P } from '../ui/kit.tsx';

export function NotAssessed({ view, onDone }: { view: NotAssessedView; onDone: () => void }) {
  return (
    <>
      <H1>No recall check</H1>
      <Card tone="NEUTRAL">
        <P>{view.headline}</P>
        {view.body.map((b) => (
          <P key={b}>{b}</P>
        ))}
      </Card>
      {view.ruleId ? <P muted>{`Policy rule ${view.ruleId}, policy version ${view.policyVersion ?? 'unknown'}`}</P> : null}
      <P>{view.disclaimer}</P>
      <Button title="Back" onPress={onDone} />
    </>
  );
}
