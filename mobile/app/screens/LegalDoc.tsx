/** Shows one bundled legal document (draft status visible). */
import React from 'react';
import { COPY } from '../../src/copy/en.ts';
import type { LegalDocument } from '../../src/legal/documents.ts';
import { Button, H1, P } from '../ui/kit.tsx';

export function LegalDoc({ doc, onBack }: { doc: LegalDocument; onBack: () => void }) {
  const paragraphs = doc.text.split(/\n{2,}/).map((p) => p.replace(/^#+\s*/, '').trim()).filter(Boolean);
  return (
    <>
      <H1>{doc.title}</H1>
      <P muted>{`Version ${doc.version} — ${doc.status === 'DRAFT' ? COPY.about.draftNotice : 'Approved'}`}</P>
      {paragraphs.map((p, i) => (
        <P key={i}>{p}</P>
      ))}
      <Button secondary title="Back" onPress={onBack} />
    </>
  );
}
