/**
 * The generic core (mobile/src/fsm/core.ts) used by an unrelated toy application — a document
 * approval flow — to show it carries no Rx-specific rules: rules, guards, gates, validation,
 * graph queries, rule-list editing and the run loop.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MachineDefinitionError,
  createMachine,
  insertBefore,
  reachable,
  runUntilIdle,
  validateDefinition,
  type Gate,
  type MachineDefinition,
  type TransitionRule,
} from '../../mobile/src/fsm/core.ts';

type S = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';
interface C { author: string; reviewer: string | null; notified: number }
type E = { type: 'SUBMIT' } | { type: 'APPROVE'; by: string } | { type: 'REJECT'; by: string } | { type: 'NOTIFIED' } | { type: 'REOPEN' };
type F = { type: 'NOTIFY'; to: string };

const rules: TransitionRule<S, C, E, F>[] = [
  { id: 'submit', from: ['DRAFT'], on: ['SUBMIT'], to: ['IN_REVIEW'], emits: ['NOTIFY'], apply: (s) => ({ name: 'IN_REVIEW', ctx: s.ctx, effects: [{ type: 'NOTIFY', to: 'reviewers' }] }) },
  {
    id: 'approve', from: ['IN_REVIEW'], on: ['APPROVE'], to: ['APPROVED'],
    guard: (_s, e) => e.type === 'APPROVE' && e.by !== '',
    apply: (s, e) => (e.type === 'APPROVE' ? { name: 'APPROVED', ctx: { ...s.ctx, reviewer: e.by } } : null),
  },
  { id: 'reject', from: ['IN_REVIEW'], on: ['REJECT'], to: ['REJECTED'], apply: (s, e) => (e.type === 'REJECT' ? { name: 'REJECTED', ctx: { ...s.ctx, reviewer: e.by } } : null) },
  { id: 'notified', from: ['IN_REVIEW'], on: ['NOTIFIED'], to: ['IN_REVIEW'], apply: (s) => ({ name: 'IN_REVIEW', ctx: { ...s.ctx, notified: s.ctx.notified + 1 } }) },
  { id: 'reopen', from: ['REJECTED'], on: ['REOPEN'], to: ['DRAFT'], apply: (s) => ({ name: 'DRAFT', ctx: { ...s.ctx, reviewer: null } }) },
];
const def: MachineDefinition<S, C, E, F> = {
  id: 'doc-approval',
  states: ['DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED'],
  initial: () => ({ name: 'DRAFT', ctx: { author: 'ann', reviewer: null, notified: 0 } }),
  rules,
};
/** Mandatory: nobody approves their own document, however the rules are arranged. */
const fourEyes: Gate<S, C, E, F> = {
  id: 'four-eyes',
  description: 'the approver must differ from the author',
  check: ({ to }) => (to.name === 'APPROVED' && to.ctx.reviewer === to.ctx.author ? 'self-approval' : null),
};
const m = createMachine(def, { gates: [fourEyes] });

test('rules, guards and ignored events', () => {
  const s1 = m.step(def.initial(), { type: 'SUBMIT' });
  assert.equal(s1.state.name, 'IN_REVIEW');
  assert.deepEqual(s1.effects, [{ type: 'NOTIFY', to: 'reviewers' }]);
  assert.equal(s1.ruleId, 'submit');
  assert.equal(m.step(s1.state, { type: 'APPROVE', by: '' }).ignored, true, 'guard false and no other rule');
  assert.equal(m.step(def.initial(), { type: 'APPROVE', by: 'bob' }).ignored, true, 'not valid in DRAFT');
  assert.equal(m.step(s1.state, { type: 'APPROVE', by: 'bob' }).state.name, 'APPROVED');
});

test('gates veto transitions regardless of rules', () => {
  const s1 = m.step(def.initial(), { type: 'SUBMIT' }).state;
  const t = m.step(s1, { type: 'APPROVE', by: 'ann' });
  assert.equal(t.rejectedBy, 'four-eyes: self-approval');
  assert.equal(t.state, s1);
});

test('rule order decides precedence; a prepended rule overrides', () => {
  const fast = createMachine(
    { ...def, rules: insertBefore(rules, 'submit', { id: 'auto-approve', from: ['DRAFT'], on: ['SUBMIT'], to: ['APPROVED'], apply: (s) => ({ name: 'APPROVED', ctx: { ...s.ctx, reviewer: 'ann' } }) }) },
    { gates: [fourEyes] },
  );
  assert.equal(fast.step(def.initial(), { type: 'SUBMIT' }).rejectedBy, 'four-eyes: self-approval', 'the gate still holds');
});

test('validation catches undeclared states and duplicate ids; undeclared targets are rejected at run time', () => {
  assert.deepEqual(validateDefinition(def), []);
  const bad = { ...def, rules: [...rules, { ...rules[0]!, to: ['ARCHIVED' as S] }] };
  const problems = validateDefinition(bad);
  assert.ok(problems.some((p) => p.includes('duplicate rule id "submit"')));
  assert.ok(problems.some((p) => p.includes('undeclared state "ARCHIVED"')));
  assert.throws(() => createMachine(bad), MachineDefinitionError);
  const liar = createMachine({ ...def, rules: [{ id: 'x', from: ['DRAFT'], on: ['SUBMIT'], to: ['IN_REVIEW'], apply: (s) => ({ name: 'APPROVED', ctx: s.ctx }) }] });
  assert.match(liar.step(def.initial(), { type: 'SUBMIT' }).rejectedBy ?? '', /^undeclared-target/);
});

test('graph queries: reachability with and without a state', () => {
  assert.deepEqual([...reachable(def)].sort(), ['APPROVED', 'DRAFT', 'IN_REVIEW', 'REJECTED']);
  assert.deepEqual([...reachable(def, { avoiding: ['IN_REVIEW'] })], ['DRAFT'], 'APPROVED is unreachable without review');
});

test('runUntilIdle executes effects and feeds their events back', async () => {
  const sent: string[] = [];
  const r = await runUntilIdle(m, def.initial(), { type: 'SUBMIT' }, async (f): Promise<E[]> => {
    sent.push(f.to);
    return [{ type: 'NOTIFIED' }];
  });
  assert.deepEqual(sent, ['reviewers']);
  assert.equal(r.state.ctx.notified, 1);
  assert.deepEqual(r.trace.map((t) => [t.event, t.to, t.ruleId]), [['SUBMIT', 'IN_REVIEW', 'submit'], ['NOTIFIED', 'IN_REVIEW', 'notified']]);
});
