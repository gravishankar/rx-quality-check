/**
 * Root component: a small state-based router (no navigation library). Screens render screen
 * models from src/app/screens.ts; every result passes through the presentation layer.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { COPY } from '../src/copy/en.ts';
import { confirmationEvent, screenFor } from '../src/app/screens.ts';
import { acknowledge, documentsNeedingAcknowledgement, memoryConsentStore, type Acknowledgements } from '../src/legal/consent.ts';
import { LEGAL_DOCUMENTS, type LegalDocumentId } from '../src/legal/documents.ts';
import { deleteAllData, openStorage, type Repositories } from '../src/storage/repositories.ts';
import type { SqlDriver } from '../src/storage/driver.ts';
import { PROFILE } from './config.ts';
import type { PlatformServices } from './platform/types.ts';
import { useRecallSession } from './useRecallSession.ts';
import { Banner, Link, P, Screen } from './ui/kit.tsx';
import { About } from './screens/About.tsx';
import { Choose } from './screens/Choose.tsx';
import { Confirm } from './screens/Confirm.tsx';
import { Entry } from './screens/Entry.tsx';
import { FirstLaunch } from './screens/FirstLaunch.tsx';
import { History } from './screens/History.tsx';
import { LegalDoc } from './screens/LegalDoc.tsx';
import { NotAssessed } from './screens/NotAssessed.tsx';
import { Problem } from './screens/Problem.tsx';
import { Result } from './screens/Result.tsx';

type Route = { name: 'check' } | { name: 'history' } | { name: 'about' } | { name: 'doc'; id: LegalDocumentId; back: Route };

// Development builds keep acknowledgements in memory only (nothing is persisted), so the notice is
// shown at every launch. Persisted builds store them in the encrypted database (Task 4B).
const consent = memoryConsentStore();

export function AppRoot({ platform }: { platform: PlatformServices }) {
  const [db, setDb] = useState<{ driver: SqlDriver; repos: Repositories } | null>(null);
  const [acks, setAcks] = useState<Acknowledgements | null>(null);
  const [route, setRoute] = useState<Route>({ name: 'check' });
  const session = useRecallSession(platform, db?.repos ?? null);

  useEffect(() => {
    void consent.load().then(setAcks);
    if (!PROFILE.persistHistory) return;
    void (async () => {
      const driver = await platform.openEncryptedDatabase();
      const { repos } = await openStorage(driver, { now: () => new Date().toISOString(), newId: () => [...platform.randomBytes(16)].map((b) => b.toString(16).padStart(2, '0')).join('') });
      setDb({ driver, repos });
    })();
  }, [platform]);

  const banner = <Banner dev={PROFILE.kind === 'development'} text={PROFILE.kind === 'development' ? COPY.app.devBanner : COPY.app.pilotBanner} />;
  const openDoc = (id: LegalDocumentId) => setRoute({ name: 'doc', id, back: route });
  const openUrl = (u: string) => void platform.openUrl(u);
  const home = useCallback(() => {
    session.reset();
    setRoute({ name: 'check' });
  }, [session]);

  if (route.name === 'doc') {
    const doc = LEGAL_DOCUMENTS.find((d) => d.id === route.id)!;
    return wrap(banner, <LegalDoc doc={doc} onBack={() => setRoute(route.back)} />);
  }
  if (acks === null) return wrap(banner, <P>Loading…</P>);
  if (documentsNeedingAcknowledgement(acks).length > 0) {
    return wrap(banner, <FirstLaunch pilot={PROFILE.kind === 'pilot'} onOpenDoc={openDoc} onAccept={() => { const a = acknowledge(acks, new Date().toISOString()); void consent.save(a); setAcks(a); }} />);
  }
  if (route.name === 'history') return wrap(banner, <History repos={db?.repos ?? null} enabled={PROFILE.persistHistory} onBack={home} />);
  if (route.name === 'about') {
    return wrap(
      banner,
      <About
        profile={PROFILE}
        os={platform.os}
        onOpenDoc={openDoc}
        onBack={home}
        onSelfTest={PROFILE.kind === 'development' ? platform.encryptionSelfTest : null}
        onDeleteAll={async () => {
          session.reset();
          if (db) await deleteAllData(db.driver, platform.keyStore);
          setDb(null);
          await consent.clear();
          setAcks({});
        }}
      />,
    );
  }

  const nav = (
    <View>
      <Link title={COPY.history.title} onPress={() => setRoute({ name: 'history' })} />
      <Link title={COPY.about.title} onPress={() => setRoute({ name: 'about' })} />
    </View>
  );
  if (session.error) return wrap(banner, <Problem headline={COPY.errors.generic} body={COPY.errors.sourceUnavailable.body} onRetry={null} onDone={home} />);
  if (session.state.name === 'SCAN') return wrap(banner, <><Entry busy={session.busy} notice={null} onSubmit={(e) => void session.start(e)} />{nav}</>);

  const m = screenFor(session.state, { now: new Date().toISOString(), persistHistory: PROFILE.persistHistory, format: (iso) => new Date(iso).toLocaleString() });
  switch (m.kind) {
    case 'WORKING':
      return wrap(banner, <P>{m.text}</P>);
    case 'ENTRY_PROBLEM':
      return wrap(banner, <><Entry busy={session.busy} notice={m.text} onSubmit={(e) => { session.reset(); void session.start(e); }} />{nav}</>);
    case 'CHOOSE_PRODUCT':
      return wrap(banner, <Choose model={m} onChoose={(index) => void session.send({ type: 'CANDIDATE_CHOSEN', index })} onDone={home} />);
    case 'CONFIRM':
      return wrap(banner, <Confirm model={m} busy={session.busy} onEdit={home} onConfirm={(ticked, release) => void session.send(confirmationEvent(ticked, m.lot, release))} />);
    case 'RESULT':
      return wrap(banner, <><Result model={m} busy={session.busy} onOpenUrl={openUrl} onDone={home} onSave={m.canSave ? () => void session.send({ type: 'SAVE_REQUESTED' }) : null} />{nav}</>);
    case 'NOT_ASSESSED':
      return wrap(banner, <><NotAssessed view={m.view} onDone={home} />{nav}</>);
    case 'SOURCE_PROBLEM':
      return wrap(banner, <Problem headline={m.headline} body={m.body} onRetry={m.canRetry ? () => void session.send({ type: 'USER_RETRY' }) : null} onDone={home} />);
    default: {
      const never: never = m;
      return never;
    }
  }
}

function wrap(banner: React.ReactNode, body: React.ReactNode) {
  return <Screen banner={banner}>{body}</Screen>;
}

export function App({ platform }: { platform: PlatformServices }) {
  return (
    <SafeAreaProvider>
      <AppRoot platform={platform} />
    </SafeAreaProvider>
  );
}
