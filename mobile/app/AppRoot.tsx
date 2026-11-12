/**
 * Root component: a small state-based router (no navigation library). Screens render screen
 * models from src/app/screens.ts; every result passes through the presentation layer.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { COPY } from '../src/copy/en.ts';
import { confirmationEvent, entryFromExtraction, screenFor } from '../src/app/screens.ts';
import { readScan } from '../src/scanner/readScan.ts';
import { vocabularyFromConfig } from '../src/scanner/vocabulary.ts';
import { acknowledge, documentsNeedingAcknowledgement, memoryConsentStore, type Acknowledgements, type ConsentStore } from '../src/legal/consent.ts';
import { LEGAL_DOCUMENTS, type LegalDocumentId } from '../src/legal/documents.ts';
import { deleteAllData, openStorage, type Repositories } from '../src/storage/repositories.ts';
import type { SqlDriver } from '../src/storage/driver.ts';
import { CATALOG_JSON, POLICY_JSON, PROFILE } from './config.ts';
import type { PlatformServices } from './platform/types.ts';
import { useRecallSession } from './useRecallSession.ts';
import { Banner, Link, P, Screen, Working } from './ui/kit.tsx';
import { About } from './screens/About.tsx';
import { Choose } from './screens/Choose.tsx';
import { Confirm } from './screens/Confirm.tsx';
import { EMPTY_ENTRY, Entry } from './screens/Entry.tsx';
import { FirstLaunch } from './screens/FirstLaunch.tsx';
import { History } from './screens/History.tsx';
import { LegalDoc } from './screens/LegalDoc.tsx';
import { NotAssessed } from './screens/NotAssessed.tsx';
import { Problem } from './screens/Problem.tsx';
import { Result } from './screens/Result.tsx';
import { ScanHome } from './screens/ScanHome.tsx';
import { ScanProblem } from './screens/ScanProblem.tsx';

const VOCABULARY = vocabularyFromConfig(CATALOG_JSON, POLICY_JSON);

interface ScanInfo {
  notes: string[];
  details: string | null;
}

type Route = { name: 'check' } | { name: 'history' } | { name: 'about' } | { name: 'doc'; id: LegalDocumentId; back: Route };

// Development builds keep acknowledgements in memory only (nothing is persisted), so the notice is
// shown at every launch. Persisted builds store them in the encrypted database (Task 4B).
const defaultConsent = memoryConsentStore();

export function AppRoot({ platform, consent = defaultConsent }: { platform: PlatformServices; consent?: ConsentStore }) {
  const [db, setDb] = useState<{ driver: SqlDriver; repos: Repositories } | null>(null);
  const [acks, setAcks] = useState<Acknowledgements | null>(null);
  const [route, setRoute] = useState<Route>({ name: 'check' });
  const [entry, setEntry] = useState(EMPTY_ENTRY);
  // Task 4C: scanning is the primary path where a scanner exists; typing is the fallback.
  const canScan = platform.scanner !== undefined;
  const [mode, setMode] = useState<'scan' | 'type'>(canScan ? 'scan' : 'type');
  const [scanPhase, setScanPhase] = useState<{ phase: 'idle' | 'reading' | 'problem'; reason?: string; notice?: string; detail?: string }>({ phase: 'idle' });
  const [scanInfo, setScanInfo] = useState<ScanInfo | null>(null);
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

  // Android Back: from any screen other than the entry screen, go back to it instead of leaving the
  // app (iOS has no Back button; the listener is a no-op there).
  const atHome = route.name === 'check' && session.state.name === 'SCAN' && !session.busy && (mode === 'scan' || !canScan) && scanPhase.phase !== 'problem';
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (atHome || session.busy) return session.busy; // while busy, ignore Back; at home, default (leave)
      if (route.name === 'doc') setRoute(route.back);
      else {
        session.reset();
        setRoute({ name: 'check' });
        setScanPhase({ phase: 'idle' });
        if (canScan && session.state.name === 'SCAN') setMode('scan');
      }
      return true;
    });
    return () => sub.remove();
  }, [atHome, route, session, canScan]);

  const banner = <Banner dev={PROFILE.kind === 'development'} text={PROFILE.kind === 'development' ? COPY.app.devBanner : COPY.app.pilotBanner} />;
  const openDoc = (id: LegalDocumentId) => setRoute({ name: 'doc', id, back: route });
  const openUrl = (u: string) => void platform.openUrl(u);
  const home = useCallback(() => {
    session.reset();
    setRoute({ name: 'check' });
    setScanPhase({ phase: 'idle' });
    setScanInfo(null);
    if (canScan) setMode('scan');
  }, [session, canScan]);

  // Photo → on-device OCR + barcodes → fields → existing identification/confirmation/recall flow.
  const scan = useCallback(async () => {
    if (!platform.scanner) return;
    session.reset();
    setScanInfo(null);
    setScanPhase({ phase: 'reading' });
    try {
      const out = await platform.scanner.scanLabel();
      if (out === null) {
        setScanPhase({ phase: 'idle', notice: COPY.scan.cancelled });
        return;
      }
      const r = readScan(out, VOCABULARY);
      setEntry(entryFromExtraction(r.extraction));
      if (r.problems.includes('NOTHING_READ') || r.problems.includes('NO_DRUG_FIELDS')) {
        const detail = PROFILE.kind === 'development' ? `${out.lines.length} text lines, ${out.barcodes.length} barcodes${ocrStatsText(out)}${out.warnings?.length ? `; ${out.warnings.join('; ')}` : ''}` : undefined;
        setScanPhase({ phase: 'problem', reason: r.problems.includes('NOTHING_READ') ? COPY.scan.nothingRead : COPY.scan.noDrugFields, ...(detail ? { detail } : {}) });
        return;
      }
      const t = out.timings;
      const codes = r.barcodes.filter((b) => b.kind === 'NDC_CODE').length;
      setScanInfo({
        notes: r.problems.includes('BARCODE_TEXT_NDC_DIFFER') ? [COPY.scan.barcodeTextDiffer] : [],
        details:
          PROFILE.kind === 'development' && t
            ? `${COPY.scan.details}: ${Math.round(t.totalMs)} ms (text ${Math.round(t.ocrMs)} ms, barcodes ${Math.round(t.barcodeMs)} ms); ${out.lines.length} text lines; ${out.barcodes.length} barcodes (${codes} drug codes); read: ${r.readFields.join(', ') || 'nothing'}${ocrStatsText(out)}${out.warnings?.length ? `; ${out.warnings.join('; ')}` : ''}`
            : null,
      });
      setScanPhase({ phase: 'idle' });
      await session.startExtraction(r.extraction);
    } catch (e) {
      // Development builds show the technical cause (exception type and location; no label content).
      const err = e as { code?: string; message?: string };
      const detail = PROFILE.kind === 'development' ? `${err.code ?? 'ERROR'}: ${err.message ?? String(e)}` : undefined;
      setScanPhase({ phase: 'problem', reason: COPY.scan.failed, ...(detail ? { detail } : {}) });
    }
  }, [platform, session]);
  const typeInstead = useCallback(() => {
    session.reset();
    setScanPhase({ phase: 'idle' });
    setScanInfo(null);
    setMode('type');
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
          setEntry(EMPTY_ENTRY);
          setScanInfo(null);
          setScanPhase({ phase: 'idle' });
          setRoute({ name: 'check' });
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
  // While the engine works (lookups, retries), show progress instead of the previous screen.
  if (session.busy) {
    const text = session.state.name === 'CONFIRM' || session.state.name === 'SOURCE_UNAVAILABLE' || session.state.name === 'RATE_LIMITED' ? COPY.working.search : session.state.name === 'SCAN' ? COPY.working.identify : COPY.working.other;
    return wrap(banner, <Working text={text} />);
  }
  if (scanPhase.phase === 'reading') return wrap(banner, <Working text={COPY.scan.reading} />);
  if (scanPhase.phase === 'problem') return wrap(banner, <ScanProblem reason={scanPhase.reason ?? COPY.scan.failed} detail={scanPhase.detail ?? null} onRescan={() => void scan()} onType={typeInstead} />);
  if (session.state.name === 'SCAN') {
    if (mode === 'scan' && canScan) return wrap(banner, <><ScanHome busy={session.busy} notice={scanPhase.notice ?? null} onScan={() => void scan()} onType={typeInstead} />{nav}</>);
    return wrap(banner, <><Entry busy={session.busy} notice={canScan ? null : COPY.scan.unavailable} value={entry} onChange={setEntry} onSubmit={(e) => { setScanInfo(null); void session.start(e); }} />{nav}</>);
  }

  const m = screenFor(session.state, { now: new Date().toISOString(), persistHistory: PROFILE.persistHistory, format: (iso) => new Date(iso).toLocaleString() });
  switch (m.kind) {
    case 'WORKING':
      return wrap(banner, <Working text={m.text} />);
    case 'ENTRY_PROBLEM':
      // After a scan that read only some fields, say so: the form is prefilled from the photo.
      return wrap(banner, <><Entry busy={session.busy} notice={scanInfo !== null && m.text === COPY.errors.missing ? COPY.scan.partialRead : m.text} value={entry} onChange={setEntry} onSubmit={(e) => { session.reset(); void session.start(e); }} />{nav}</>);
    case 'CHOOSE_PRODUCT':
      return wrap(banner, <Choose model={m} onChoose={(index) => void session.send({ type: 'CANDIDATE_CHOSEN', index })} onDone={home} />);
    case 'CONFIRM':
      return wrap(
        banner,
        <>
          <Confirm
            model={m}
            busy={session.busy}
            scanned={scanInfo !== null}
            scanNotes={scanInfo?.notes ?? []}
            onRescan={scanInfo !== null ? () => void scan() : undefined}
            onEdit={typeInstead}
            onConfirm={(ticked, release) => void session.send(confirmationEvent(ticked, m.lot, release))}
          />
          {scanInfo?.details ? <P muted>{scanInfo.details}</P> : null}
        </>,
      );
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

/** OCR counts for the development detail line (no label content). */
function ocrStatsText(out: { ocrStats?: { regions: number; droppedEmpty: number; droppedLowScore: number; dictionary: number } }): string {
  const s = out.ocrStats;
  return s && s.regions !== undefined ? `; text regions ${s.regions} (empty ${s.droppedEmpty}, unclear ${s.droppedLowScore}); dictionary ${s.dictionary}` : '';
}

function wrap(banner: React.ReactNode, body: React.ReactNode) {
  return <Screen banner={banner}>{body}</Screen>;
}

export function App({ platform, consent }: { platform: PlatformServices; consent?: ConsentStore }) {
  return (
    <SafeAreaProvider>
      <AppRoot platform={platform} {...(consent ? { consent } : {})} />
    </SafeAreaProvider>
  );
}
