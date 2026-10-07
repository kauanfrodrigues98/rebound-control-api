import {
  contractSnapshotSchema,
  entitlementOverridesSchema,
  type ContractSnapshot,
} from './contract-terms';
const terms: ContractSnapshot = {
  sourceRevisionId: '00000000-0000-4000-8000-000000000001',
  sourceVersion: 1,
  customerId: '00000000-0000-4000-8000-000000000002',
  contractId: '00000000-0000-4000-8000-000000000003',
  planId: 'individual',
  pricing: 'custom',
  priceVersionId: null,
  billingMode: 'courtesy',
  amount: 0,
  setupAmount: 0,
  currency: 'BRL',
  intervalMonths: 1,
  dueDay: 1,
  allowedMethods: ['card', 'boleto'],
  startsOn: '2026-01-01',
  endsOn: null,
  effectiveAt: '2026-10-01T03:00:00Z',
  courtesyExpiresAt: null,
  entitlements: { maxUsers: 'unlimited', aiEnabled: true },
  reason: 'Parceria institucional',
};
describe('courtesy contract validation', () => {
  it('accepts free courtesy with explicit unlimited entitlements', () => {
    expect(contractSnapshotSchema.parse(terms)).toEqual(terms);
  });
  it('rejects paid courtesy and expired validity before the grant', () => {
    expect(
      contractSnapshotSchema.safeParse({ ...terms, amount: 1 }).success,
    ).toBe(false);
    expect(
      contractSnapshotSchema.safeParse({
        ...terms,
        courtesyExpiresAt: '2026-09-01T00:00:00Z',
      }).success,
    ).toBe(false);
  });
  it('supports precise maximums and all replay feature flags', () => {
    expect(
      entitlementOverridesSchema.parse({
        maxUsers: 'unlimited',
        maxMonthlyEvents: 10000,
        maxAiAnalysisMonthly: 0,
        manualReplayEnabled: true,
        automaticReplayEnabled: false,
      }),
    ).toEqual({
      maxUsers: 'unlimited',
      maxMonthlyEvents: 10000,
      maxAiAnalysisMonthly: 0,
      manualReplayEnabled: true,
      automaticReplayEnabled: false,
    });
    expect(
      entitlementOverridesSchema.safeParse({ maxUsers: 'anything' }).success,
    ).toBe(false);
  });
  it('preserves legacy ordinary snapshots without the new optional fields', () => {
    const { billingMode, courtesyExpiresAt, ...legacy } = terms;
    expect(contractSnapshotSchema.safeParse(legacy).success).toBe(true);
  });
});
