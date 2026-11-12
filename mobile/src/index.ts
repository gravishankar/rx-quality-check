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
// Task 3: services, storage (the Node-only test driver is deliberately not exported) and app wiring.
export * from './services/classify.ts';
export * from './services/transport.ts';
export * from './services/request.ts';
export { OPENFDA_BASE, OPENFDA_MAX_LIMIT, OPENFDA_MAX_SKIP, createOpenFdaClient, enforcementUrl, ndcUrl, type OpenFdaClient } from './services/openfda.ts';
export * from './services/rxnav.ts';
export * from './services/dailymed.ts';
export * from './services/xml.ts';
export * from './services/ports.ts';
export * from './storage/driver.ts';
export * from './storage/keys.ts';
export * from './storage/migrations.ts';
export * from './storage/repositories.ts';
export * from './storage/drivers/opSqlite.ts';
export * from './app/recallCheck.ts';
