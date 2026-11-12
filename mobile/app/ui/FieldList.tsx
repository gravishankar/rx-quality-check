/** Identity fields with where each value came from (verified vs entered vs conflicting). */
import React from 'react';
import { Text, View } from 'react-native';
import { COPY } from '../../src/copy/en.ts';
import type { FieldView } from '../../src/presentation/present.ts';
import { COLORS, s } from './kit.tsx';

export function FieldList({ fields }: { fields: FieldView[] }) {
  return (
    <View>
      {fields.map((f) => (
        <View key={f.key} style={s.fieldRow} accessible accessibilityLabel={`${f.label}: ${f.value}. ${COPY.evidence[f.evidence]}. ${f.note ?? ''}`}>
          <Text style={s.label}>{f.label}</Text>
          <Text style={s.p}>{f.value}</Text>
          <Text style={[s.p, { color: f.evidence === 'CONFLICTING' ? COLORS.CAUTION : COLORS.muted, fontSize: 14 }]}>{COPY.evidence[f.evidence]}</Text>
          {f.note ? <Text style={[s.p, { color: COLORS.muted, fontSize: 14 }]}>{f.note}</Text> : null}
        </View>
      ))}
    </View>
  );
}
