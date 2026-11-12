/**
 * Result (Task 4C build 7: summary first). Renders a ResultView from the presentation layer only.
 * Order: result card (category, headline, record summary, qualifiers) → limits and the standing
 * disclaimer → next steps → records that match / might match / could not be read (always shown as
 * cards) → records conclusively excluded by the engine (counted by primary reason; the records
 * themselves behind "Show") → what we checked (sources and dates) → the medication checked.
 * No success styling exists for any category.
 */
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { COPY } from '../../src/copy/en.ts';
import type { ScreenModel } from '../../src/app/screens.ts';
import { FDA_ENFORCEMENT_REPORTS_URL, type RecordView } from '../../src/presentation/present.ts';
import { FieldList } from '../ui/FieldList.tsx';
import { Button, Card, H1, Link, P, Section, s } from '../ui/kit.tsx';

type Result = Extract<ScreenModel, { kind: 'RESULT' }>;

/** Records shown before "Show more" in the "might match" group (all are reachable; none are mixed with excluded records). */
export const POSSIBLE_SHOWN = 3;

function Line({ label, value }: { label: string; value: string }) {
  return (
    <P>
      <Text style={{ fontWeight: '600' }}>{label}: </Text>
      {value}
    </P>
  );
}

function RecordCard({ r, onOpenUrl }: { r: RecordView; onOpenUrl: (u: string) => void }) {
  const [open, setOpen] = useState(false);
  const R = COPY.result.record;
  return (
    <View style={s.fieldRow}>
      {r.excluded ? <Line label={R.whyExcluded} value={r.excluded.primaryText} /> : null}
      {r.excluded && r.excluded.others.length > 0 ? <Line label={R.alsoDiffers} value={r.excluded.others.join('; ')} /> : null}
      {r.lines.map((l) => (
        <Line key={l.label} label={l.label} value={l.value} />
      ))}
      {r.lotNote ? <P>{r.lotNote}</P> : null}
      {r.more.length > 0 ? <Link title={open ? R.lessDetails : R.moreDetails} onPress={() => setOpen(!open)} /> : null}
      {open ? r.more.map((l) => <Line key={l.label} label={l.label} value={l.value} />) : null}
      <Link title={R.officialRecord} onPress={() => onOpenUrl(r.officialRecordUrl)} />
    </View>
  );
}

export function Result({ model, onOpenUrl, onSave, onDone, busy }: { model: Result; onOpenUrl: (u: string) => void; onSave: (() => void) | null; onDone: () => void; busy: boolean }) {
  const v = model.view;
  const [morePossible, setMorePossible] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);
  const of = (g: RecordView['group']) => v.records.filter((r) => r.group === g);
  const possible = of('possible');
  const excluded = of('notApplicable');
  const X = COPY.result.excluded;
  const statusNote = <P muted>{COPY.result.record.statusNote}</P>;
  const card = (r: RecordView) => <RecordCard key={r.recallNumber + r.group} r={r} onOpenUrl={onOpenUrl} />;
  return (
    <>
      <H1>Recall check result</H1>
      <Card tone={v.tone} label={COPY.result.categoryLabel[v.category]}>
        <Text accessibilityRole="header" style={[s.p, { fontWeight: '700', fontSize: 18 }]}>
          {v.headline}
        </Text>
        <P>{v.summary}</P>
        {v.qualifiers.map((q) => (
          <P key={q}>{q}</P>
        ))}
        {v.downgrade ? v.downgrade.reasons.map((r) => <P key={r}>{r}</P>) : null}
      </Card>
      <Section title={COPY.result.limitsTitle}>
        {v.limitations.map((x) => (
          <P key={x}>• {x}</P>
        ))}
        <P>{v.disclaimer}</P>
      </Section>
      {v.nextSteps.map((n) => (
        <P key={n}>• {n}</P>
      ))}
      {of('matches').length > 0 ? (
        <Section title={COPY.result.groups.matches}>
          {statusNote}
          {of('matches').map(card)}
        </Section>
      ) : null}
      {possible.length > 0 ? (
        <Section title={COPY.result.groups.possible}>
          {statusNote}
          {(morePossible ? possible : possible.slice(0, POSSIBLE_SHOWN)).map(card)}
          {!morePossible && possible.length > POSSIBLE_SHOWN ? <Link title={COPY.result.showMorePossible(possible.length - POSSIBLE_SHOWN)} onPress={() => setMorePossible(true)} /> : null}
        </Section>
      ) : null}
      {of('unreadable').length > 0 ? (
        <Section title={COPY.result.groups.unreadable}>
          {statusNote}
          {of('unreadable').map(card)}
        </Section>
      ) : null}
      {excluded.length > 0 ? (
        <Section title={X.title}>
          <P>{X.intro(v.exclusions.total)}</P>
          {v.exclusions.reasons.map((x) => (
            <P key={x.reason}>{`• ${x.text}: ${x.count}`}</P>
          ))}
          {v.exclusions.multipleDifferences > 0 ? <P muted>{X.overlap(v.exclusions.multipleDifferences)}</P> : null}
          <Link title={showExcluded ? X.hide : X.show(excluded.length)} onPress={() => setShowExcluded(!showExcluded)} />
          {showExcluded ? statusNote : null}
          {showExcluded ? excluded.map(card) : null}
        </Section>
      ) : null}
      <Section title={COPY.result.sources.title}>
        {v.sources.map((x) => (
          <P key={x} muted>
            {x}
          </P>
        ))}
      </Section>
      <Section title="The medication we checked">
        <FieldList fields={model.fields} />
      </Section>
      <Link title={COPY.result.record.fdaRecallPages} onPress={() => onOpenUrl(FDA_ENFORCEMENT_REPORTS_URL)} />
      {model.saveError ? <P>{COPY.errors.generic}</P> : null}
      {onSave && !model.saved ? <Button secondary title="Save on this phone" onPress={onSave} disabled={busy} /> : null}
      {model.saved ? <P muted>Saved on this phone.</P> : null}
      <Button title={COPY.result.nextSteps.checkAgain} onPress={onDone} />
    </>
  );
}
