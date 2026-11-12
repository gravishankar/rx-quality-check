/** Home / manual entry. No camera or OCR in v0.1 (Task 4A §9). */
import React, { useState } from 'react';
import { Text, TextInput } from 'react-native';
import { COPY } from '../../src/copy/en.ts';
import type { ManualEntry } from '../../src/app/screens.ts';
import { Button, H1, P, s } from '../ui/kit.tsx';

const FIELDS: { key: keyof ManualEntry; label: string; help?: string }[] = [
  { key: 'ndc', label: COPY.entry.ndcLabel, help: COPY.entry.ndcHelp },
  { key: 'drugName', label: COPY.entry.nameLabel },
  { key: 'strength', label: COPY.entry.strengthLabel },
  { key: 'form', label: COPY.entry.formLabel },
  { key: 'lot', label: COPY.entry.lotLabel, help: COPY.entry.lotHelp },
];

export function Entry({ onSubmit, busy, notice }: { onSubmit: (e: ManualEntry) => void; busy: boolean; notice: string | null }) {
  const [v, setV] = useState<ManualEntry>({ ndc: '', drugName: '', strength: '', form: '', lot: '' });
  return (
    <>
      <P muted>{COPY.app.name}</P>
      <H1>{COPY.entry.title}</H1>
      <P>{COPY.entry.intro}</P>
      <P muted>{COPY.entry.noCamera}</P>
      <P muted>{COPY.disclaimer.notMonitoring}</P>
      {notice ? <P>{notice}</P> : null}
      {FIELDS.map((f) => (
        <React.Fragment key={f.key}>
          <Text style={s.label} nativeID={`lbl-${f.key}`}>
            {f.label}
          </Text>
          <TextInput
            accessibilityLabelledBy={`lbl-${f.key}`}
            accessibilityLabel={f.label}
            style={s.input}
            value={v[f.key]}
            onChangeText={(t) => setV({ ...v, [f.key]: t })}
            autoCapitalize="characters"
            autoCorrect={false}
            // Keyboard learning off: medication details are not added to the keyboard's dictionary.
            autoComplete="off"
            importantForAutofill="no"
            keyboardType={f.key === 'ndc' ? 'numbers-and-punctuation' : 'default'}
          />
          {f.help ? <P muted>{f.help}</P> : null}
        </React.Fragment>
      ))}
      <Button title={COPY.entry.submit} onPress={() => onSubmit(v)} disabled={busy} />
    </>
  );
}
