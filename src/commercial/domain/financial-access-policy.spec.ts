import { financialAccess } from './financial-access-policy';
const due = '2026-10-01T12:00:00.000Z';
describe('financial access policy', () => {
  it.each([
    [3, 'payment_attention'],
    [4, 'payment_restricted'],
    [7, 'payment_restricted'],
    [8, 'payment_suspended'],
  ])('classifies %s complete days', (days, state) => {
    expect(
      financialAccess(
        due,
        true,
        new Date(new Date(due).getTime() + Number(days) * 86400000),
      ).effectiveState,
    ).toBe(state);
  });
  it('does not restrict one millisecond before the boundary', () => {
    expect(
      financialAccess(
        due,
        true,
        new Date(new Date(due).getTime() + 4 * 86400000 - 1),
      ).state,
    ).toBe('payment_attention');
  });
  it('observes debt without enforcing it when disabled', () => {
    expect(
      financialAccess(due, false, new Date('2026-10-10T12:00:00Z')),
    ).toMatchObject({ state: 'payment_suspended', effectiveState: 'healthy' });
  });
  it('recovers when there is no overdue balance', () => {
    expect(financialAccess(null, true)).toMatchObject({
      state: 'healthy',
      overdueSince: null,
      daysPastDue: null,
    });
  });
  it('does not classify a future timestamp as overdue', () => {
    expect(
      financialAccess(due, true, new Date('2026-10-01T11:59:00Z')).state,
    ).toBe('healthy');
  });
});
