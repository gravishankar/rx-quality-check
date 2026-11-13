/**
 * Saved checks. Disabled unless the build persists history (pilot build with encryption verified on
 * a device). Saved results are re-presented with origin SAVED, so an old result is shown as too old
 * to rely on rather than as a current "no match".
 */
import React, { useEffect, useState } from 'react';
import { COPY } from '../../src/copy/en.ts';
import { presentResult, type ResultView } from '../../src/presentation/present.ts';
import type { Repositories } from '../../src/storage/repositories.ts';
import { Button, Card, H1, P, Section } from '../ui/kit.tsx';

interface Row {
  id: string;
  name: string;
  view: ResultView | null;
  versions: string | null;
  fill: string | null;
}

export function History({ repos, enabled, onBack, failure = null }: { repos: Repositories | null; enabled: boolean; onBack: () => void; failure?: 'KEY' | 'OPEN' | 'MIGRATION' | 'DELETE' | null }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (!enabled || !repos) return;
    void (async () => {
      const out: Row[] = [];
      for (const m of await repos.medications.list()) {
        // The assessment is shown with the exact fill it was made for (review item 6).
        const latest = await repos.assessments.latestWithFill(m.id);
        const a = latest?.assessment ?? null;
        const view = latest ? presentResult({ identity: latest.fill.identity, finding: latest.assessment.finding, now: new Date().toISOString(), origin: 'SAVED' }) : null;
        const fi = latest?.fill.identity;
        const fill = latest && fi ? COPY.history.fillLine(fi.packageNdc ?? fi.productNdc ?? 'not identified', fi.lot, new Date(latest.assessment.evaluatedAt).toLocaleString()) : null;
        out.push({ id: m.id, name: m.displayName, view, versions: a ? `${a.versions.catalogVersion} / ${a.versions.policyVersion}` : null, fill });
      }
      setRows(out);
    })();
  }, [enabled, repos]);

  return (
    <>
      <H1>{COPY.history.title}</H1>
      {failure ? <P>{COPY.history.storageFailed[failure]}</P> : null}
      {!enabled ? <P>{COPY.history.disabled}</P> : rows === null ? <P>Loading…</P> : rows.length === 0 ? <P>{COPY.history.empty}</P> : null}
      {rows?.map((r) => (
        <Section key={r.id} title={r.name}>
          {r.fill ? <P muted>{r.fill}</P> : null}
          {r.view ? (
            <Card tone={r.view.tone}>
              <P>{r.view.headline}</P>
              {r.view.downgrade?.reasons.map((x) => <P key={x}>{x}</P>)}
            </Card>
          ) : null}
          {r.versions ? <P muted>{COPY.history.madeUnder(r.versions)}</P> : null}
          <Button secondary title={COPY.history.deleteOne} onPress={() => void repos?.medications.delete(r.id).then(() => setRows((x) => x?.filter((y) => y.id !== r.id) ?? null))} />
        </Section>
      ))}
      <Button secondary title="Back" onPress={onBack} />
    </>
  );
}
