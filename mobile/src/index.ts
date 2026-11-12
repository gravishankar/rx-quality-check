/**
 * Rx Quality Check core library (Task 2): pure TypeScript, no React Native, no network, no storage.
 * Platform services (HTTP clients, SQLite, OCR) are injected as ports in Tasks 3–5.
 */
export * from './models/lookup.ts';
export * from './models/openfda.ts';
export * from './models/identity.ts';
export * from './models/policy.ts';
export * from './models/evidence.ts';
export * from './models/explanation.ts';
export * from './rules/ndc.ts';
export * from './rules/strength.ts';
export * from './rules/doseForm.ts';
export * from './rules/ingredients.ts';
export * from './rules/catalog.ts';
export * from './rules/exclusion.ts';
export * from './rules/identity.ts';
export * from './rules/lot.ts';
export * from './rules/recallRecord.ts';
export * from './rules/recallEvidence.ts';
export * from './rules/refill.ts';
export * from './rules/explanation.ts';
export * from './rules/version.ts';
export * from './fsm/core.ts';
export * from './state/machine.ts';
export * from './engine/runner.ts';
