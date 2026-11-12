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
}

export function History({ repos, enabled, onBack }: { repos: Repositories | null; enabled: boolean; onBack: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (!enabled || !repos) return;
    void (async () => {
      const out: Row[] = [];
      for (const m of await repos.medications.list()) {
        const a = await repos.assessments.latestForMedication(m.id);
        const fill = (await repos.fills.history(m.id))[0];
        const view = a && fill ? presentResult({ identity: fill.identity, finding: a.finding, now: new Date().toISOString(), origin: 'SAVED' }) : null;
        out.push({ id: m.id, name: m.displayName, view, versions: a ? `${a.versions.catalogVersion} / ${a.versions.policyVersion}` : null });
      }
      setRows(out);
    })();
  }, [enabled, repos]);

  return (
    <>
      <H1>{COPY.history.title}</H1>
      {!enabled ? <P>{COPY.history.disabled}</P> : rows === null ? <P>Loading…</P> : rows.length === 0 ? <P>{COPY.history.empty}</P> : null}
      {rows?.map((r) => (
        <Section key={r.id} title={r.name}>
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
