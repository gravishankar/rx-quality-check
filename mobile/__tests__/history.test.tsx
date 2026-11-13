/**
 * Review item 6 on the real History screen: a saved check is shown with the bottle (fill) it was
 * made for. Repositories are a fake (native storage cannot run under Jest); identities and the
 * finding are SYNTHETIC values in the app's own shapes.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { History } from '../app/screens/History.tsx';
import type { Repositories } from '../src/storage/repositories.ts';
import type { MedicationIdentity } from '../src/models/identity.ts';
import type { RecallFinding } from '../src/models/evidence.ts';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const identity = (lot: string | null, pkg: string): MedicationIdentity => ({
  level: 'PRODUCT', productNdc: '62756-142', packageNdc: pkg, labelerName: 'SYNTHETIC labeler', ingredients: [{ name: 'metformin', salt: 'hydrochloride', rxcui: null, strength: { value: 500, unit: 'MG', per: '1' } }],
  doseForm: 'TABLET', release: 'ER', routes: ['ORAL'], productType: null, pharmClassEpc: [], relatedSourceProductNdcs: [], lot, sourceProductStatus: 'NOT_APPLICABLE',
});
const finding = { finding: 'CONFIRMED_MATCH', confirmed: [], potential: [], unresolved: [], notApplicable: [], limitations: [], rulesetVersion: 'x', evaluatedAt: '2026-11-12T12:00:00.000Z',
  coverage: { complete: true, searchAdequate: true, queries: [], positiveControl: { status: 'PASSED', detail: '' }, datasetLastUpdated: '2026-11-04' } } as unknown as RecallFinding;

const oldFill = { id: 'f1', scannedAt: '2026-10-01T12:00:00.000Z', identity: identity(null, '62756-142-02') };
const newFill = { id: 'f2', scannedAt: '2026-11-12T12:00:00.000Z', identity: identity('SYNTHLOT2', '62756-142-13') };
const repos = {
  medications: { list: async () => [{ id: 'm1', displayName: 'Metformin ER', catalogDrugId: null, createdAt: '2026-10-01T12:00:00.000Z' }], delete: async () => undefined },
  fills: { history: async () => [oldFill, newFill] },
  assessments: {
    latestForMedication: async () => ({ id: 'a2', fillId: 'f2', medicationId: 'm1', evaluatedAt: finding.evaluatedAt, savedAt: finding.evaluatedAt, finding, versions: { rulesetVersion: 'x', policyVersion: 'p', catalogVersion: 'c' } }),
    latestWithFill: async () => ({ assessment: { id: 'a2', fillId: 'f2', medicationId: 'm1', evaluatedAt: finding.evaluatedAt, savedAt: finding.evaluatedAt, finding, versions: { rulesetVersion: 'x', policyVersion: 'p', catalogVersion: 'c' } }, fill: newFill }),
  },
} as unknown as Repositories;

const text = (r: ReactTestRenderer) => r.root.findAll((n) => typeof n.type === 'string' && n.type === 'Text').map((n) => [n.props.children as unknown].flat(3).join('')).join('\n');

test('item 6: the saved check is shown with the bottle it was made for', async () => {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<History repos={repos} enabled onBack={() => undefined} />);
  });
  await act(async () => new Promise((res) => setTimeout(res, 0)));
  const t = text(r);
  expect(t).toContain('62756-142-13');
  expect(t).toContain('SYNTHLOT2');
  expect(t).not.toContain('62756-142-02');
});
