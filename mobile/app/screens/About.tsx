/**
 * About, privacy, legal documents, data sources, delete-all and (development builds only) the
 * on-device encryption self-test (PV-4). Permanently reachable from every screen.
 */
import React, { useState } from 'react';
import { Alert } from 'react-native';
import { COPY } from '../../src/copy/en.ts';
import { LEGAL_DOCUMENTS, type LegalDocumentId } from '../../src/legal/documents.ts';
import type { SelfTestResult } from '../../src/storage/encryptionSelfTest.ts';
import type { BuildProfile } from '../../src/app/buildProfile.ts';
import { Button, H1, Link, P, Section } from '../ui/kit.tsx';

export function About(p: {
  profile: BuildProfile;
  os: string;
  onOpenDoc: (id: LegalDocumentId) => void;
  onDeleteAll: () => Promise<void>;
  onSelfTest: (() => Promise<SelfTestResult>) | null;
  onBack: () => void;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [test, setTest] = useState<SelfTestResult | null>(null);
  const confirmDelete = () =>
    Alert.alert(COPY.about.deleteAll, COPY.about.deleteAllConfirm, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void p.onDeleteAll().then(() => setMsg(COPY.about.deleted), () => setMsg(COPY.errors.generic)) },
    ]);
  return (
    <>
      <H1>{COPY.about.title}</H1>
      <P>{COPY.about.version(p.profile.appVersion, p.profile.buildNumber, p.profile.label)}</P>
      <P muted>{COPY.app.tagline}</P>
      <P muted>{COPY.app.provisionalName}</P>
      <P muted>{`Platform: ${p.os}`}</P>
      <P>{COPY.disclaimer.noTreatmentAdvice}</P>
      <P>{COPY.disclaimer.notMonitoring}</P>
      <P>{COPY.about.attribution}</P>
      <Section title={COPY.about.documents}>
        <P muted>{COPY.about.draftNotice}</P>
        {LEGAL_DOCUMENTS.map((d) => (
          <Link key={d.id} title={`${d.title} (${d.version})`} onPress={() => p.onOpenDoc(d.id)} />
        ))}
      </Section>
      <Section title={COPY.about.deleteAll}>
        <Button secondary title={COPY.about.deleteAll} onPress={confirmDelete} />
        {msg ? <P>{msg}</P> : null}
      </Section>
      {p.onSelfTest ? (
        <Section title="Storage encryption self-test (development)">
          <P muted>Runs on a temporary database, never on your data. Record the result in the device test plan.</P>
          <Button secondary title="Run encryption self-test" onPress={() => void p.onSelfTest?.().then(setTest)} />
          {test ? (
            <>
              <P>{test.passed ? 'Self-test: all steps passed' : 'Self-test: FAILED'}</P>
              {test.steps.map((x) => (
                <P key={x.name} muted>{`${x.passed ? 'PASS' : 'FAIL'} — ${x.name}: ${x.detail}`}</P>
              ))}
            </>
          ) : null}
        </Section>
      ) : null}
      <Button secondary title="Back" onPress={p.onBack} />
    </>
  );
}
