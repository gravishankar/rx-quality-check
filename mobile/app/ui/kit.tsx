/**
 * Minimal accessible UI kit. Rules (docs/EVIDENCE_AND_CLAIMS_POLICY.md §6):
 *  - No success styling: no green, no check marks, no celebratory icons. Tones are ALERT (dark red),
 *    CAUTION (dark amber) and NEUTRAL (gray), and every tone is also stated in words (never color only).
 *  - Text scales with the system font size; touch targets are at least 48 dp; contrast ≥ 4.5:1.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Tone } from '../../src/presentation/present.ts';

export const COLORS = {
  text: '#1a1a1a',
  muted: '#4a4a4a',
  bg: '#ffffff',
  line: '#c8c8c8',
  link: '#0b4f8a',
  ALERT: '#8b1a1a',
  CAUTION: '#7a4b00',
  NEUTRAL: '#4a4a4a',
  bannerDev: '#5c1f7a',
  bannerPilot: '#333333',
} as const;

export const TONE_WORD: Record<Tone, string> = {
  ALERT: 'Recall information found',
  CAUTION: 'Possible recall',
  NEUTRAL: 'Result',
};

export function Banner({ text, dev }: { text: string; dev: boolean }) {
  return (
    <View accessibilityRole="text" style={[s.banner, { backgroundColor: dev ? COLORS.bannerDev : COLORS.bannerPilot }]}>
      <Text style={s.bannerText}>{text}</Text>
    </View>
  );
}

export function Screen({ banner, children }: { banner: React.ReactNode; children: React.ReactNode }) {
  return (
    <SafeAreaView style={s.root}>
      {banner}
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export const H1 = ({ children }: { children: React.ReactNode }) => (
  <Text accessibilityRole="header" style={s.h1}>
    {children}
  </Text>
);
export const H2 = ({ children }: { children: React.ReactNode }) => (
  <Text accessibilityRole="header" style={s.h2}>
    {children}
  </Text>
);
export const P = ({ children, muted }: { children: React.ReactNode; muted?: boolean }) => <Text style={[s.p, muted ? { color: COLORS.muted } : null]}>{children}</Text>;

export function Button({ title, onPress, secondary, disabled }: { title: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [s.btn, secondary ? s.btnSecondary : s.btnPrimary, disabled ? { opacity: 0.45 } : null, pressed ? { opacity: 0.7 } : null]}
    >
      <Text style={[s.btnText, secondary ? { color: COLORS.link } : { color: '#fff' }]}>{title}</Text>
    </Pressable>
  );
}

export function Link({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="link" onPress={onPress} style={s.link}>
      <Text style={s.linkText}>{title}</Text>
    </Pressable>
  );
}

/** A labeled switch (not a check mark). */
export function Tick({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={s.tick}>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange} />
      <Text style={[s.p, { flex: 1, marginLeft: 12 }]}>{label}</Text>
    </View>
  );
}

export function Card({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <View style={[s.card, { borderLeftColor: COLORS[tone] }]}>
      <Text style={[s.toneWord, { color: COLORS[tone] }]}>{TONE_WORD[tone]}</Text>
      {children}
    </View>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <H2>{title}</H2>
      {children}
    </View>
  );
}

export const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, paddingBottom: 48 },
  banner: { paddingVertical: 8, paddingHorizontal: 16 },
  bannerText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  h1: { fontSize: 24, fontWeight: '700', color: COLORS.text, marginBottom: 12 },
  h2: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginTop: 16, marginBottom: 8 },
  p: { fontSize: 16, lineHeight: 23, color: COLORS.text, marginBottom: 8 },
  btn: { minHeight: 48, borderRadius: 6, paddingHorizontal: 16, justifyContent: 'center', marginVertical: 6 },
  btnPrimary: { backgroundColor: '#0b4f8a' },
  btnSecondary: { borderWidth: 1, borderColor: '#0b4f8a', backgroundColor: '#fff' },
  btnText: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  link: { minHeight: 48, justifyContent: 'center' },
  linkText: { fontSize: 16, color: COLORS.link, textDecorationLine: 'underline' },
  tick: { flexDirection: 'row', alignItems: 'center', minHeight: 48, marginVertical: 4 },
  card: { borderLeftWidth: 6, borderWidth: 1, borderColor: COLORS.line, padding: 12, marginVertical: 8, backgroundColor: '#fafafa' },
  toneWord: { fontSize: 14, fontWeight: '700', textTransform: 'uppercase', marginBottom: 6 },
  section: { marginTop: 8 },
  input: { borderWidth: 1, borderColor: '#767676', borderRadius: 4, minHeight: 48, paddingHorizontal: 12, fontSize: 16, color: COLORS.text, marginBottom: 4 },
  label: { fontSize: 16, fontWeight: '600', color: COLORS.text, marginTop: 12, marginBottom: 4 },
  fieldRow: { borderBottomWidth: 1, borderBottomColor: COLORS.line, paddingVertical: 8 },
});
