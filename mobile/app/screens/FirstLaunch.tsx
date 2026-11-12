/** First-launch notice (Task 4A §8). Records the document versions seen, on this phone only. */
import React from 'react';
import { COPY } from '../../src/copy/en.ts';
import { Button, H1, Link, P } from '../ui/kit.tsx';
import type { LegalDocumentId } from '../../src/legal/documents.ts';

export function FirstLaunch({ onOpenDoc, onAccept, pilot }: { onOpenDoc: (id: LegalDocumentId) => void; onAccept: () => void; pilot: boolean }) {
  return (
    <>
      <H1>{COPY.app.name}</H1>
      <P muted>{COPY.app.tagline}</P>
      <H1>{COPY.firstLaunch.title}</H1>
      {COPY.firstLaunch.points.map((p) => (
        <P key={p}>• {p}</P>
      ))}
      <P>{COPY.disclaimer.standing}</P>
      {pilot ? <P>{COPY.app.pilotBanner}</P> : <P>{COPY.app.devBanner}</P>}
      <Link title={COPY.firstLaunch.readTerms} onPress={() => onOpenDoc('terms')} />
      <Link title={COPY.firstLaunch.readPrivacy} onPress={() => onOpenDoc('privacy')} />
      <Link title={COPY.firstLaunch.readMedical} onPress={() => onOpenDoc('medical')} />
      <P muted>{COPY.about.draftNotice}</P>
      <P muted>{COPY.firstLaunch.acknowledgementNote}</P>
      <Button title={COPY.firstLaunch.acknowledge} onPress={onAccept} />
    </>
  );
}
