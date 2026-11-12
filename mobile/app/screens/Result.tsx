/**
 * Result. Renders a ResultView from the presentation layer only. Sources, retrieval date,
 * uncertainty and limitations are shown on the same screen as the headline (Task 4A §8), followed
 * by the records. No success styling exists for any category.
 */
import React from 'react';
import { Text, View } from 'react-native';
import { COPY } from '../../src/copy/en.ts';
import type { ScreenModel } from '../../src/app/screens.ts';
import { FDA_ENFORCEMENT_REPORTS_URL } from '../../src/presentation/present.ts';
import { FieldList } from '../ui/FieldList.tsx';
import { Button, Card, H1, Link, P, Section, s } from '../ui/kit.tsx';

type Result = Extract<ScreenModel, { kind: 'RESULT' }>;

export function Result({ model, onOpenUrl, onSave, onDone, busy }: { model: Result; onOpenUrl: (u: string) => void; onSave: (() => void) | null; onDone: () => void; busy: boolean }) {
  const v = model.view;
  const groups = (['matches', 'possible', 'unreadable', 'notApplicable'] as const).map((g) => ({ g, recs: v.records.filter((r) => r.group === g) })).filter((x) => x.recs.length > 0);
  return (
    <>
      <H1>Recall check result</H1>
      <Card tone={v.tone} label={COPY.result.categoryLabel[v.category]}>
        <Text accessibilityRole="header" style={[s.p, { fontWeight: '700', fontSize: 18 }]}>
          {v.headline}
        </Text>
        {v.qualifiers.map((q) => (
          <P key={q}>{q}</P>
        ))}
        {v.downgrade ? v.downgrade.reasons.map((r) => <P key={r}>{r}</P>) : null}
      </Card>
      {v.nextSteps.map((n) => (
        <P key={n}>• {n}</P>
      ))}
      <Section title={COPY.result.sources.title}>
        {v.sources.map((x) => (
          <P key={x} muted>
            {x}
          </P>
        ))}
      </Section>
      <Section title={COPY.result.limitationsTitle}>
        {v.limitations.map((x) => (
          <P key={x}>• {x}</P>
        ))}
        <P>{v.disclaimer}</P>
      </Section>
      <Section title="The medication we checked">
        <FieldList fields={model.fields} />
      </Section>
      {groups.map(({ g, recs }) => (
        <Section key={g} title={COPY.result.groups[g]}>
          {recs.map((r) => (
            <View key={r.recallNumber + g} style={s.fieldRow}>
              {r.lines.map((l) => (
                <P key={l.label}>
                  <Text style={{ fontWeight: '600' }}>{l.label}: </Text>
                  {l.value}
                </P>
              ))}
              {r.lotNote ? <P>{r.lotNote}</P> : null}
              <Link title={COPY.result.record.officialRecord} onPress={() => onOpenUrl(r.officialRecordUrl)} />
            </View>
          ))}
        </Section>
      ))}
      <Link title={COPY.result.record.fdaRecallPages} onPress={() => onOpenUrl(FDA_ENFORCEMENT_REPORTS_URL)} />
      {model.saveError ? <P>{COPY.errors.generic}</P> : null}
      {onSave && !model.saved ? <Button secondary title="Save on this phone" onPress={onSave} disabled={busy} /> : null}
      {model.saved ? <P muted>Saved on this phone.</P> : null}
      <Button title={COPY.result.nextSteps.checkAgain} onPress={onDone} />
    </>
  );
}
