import { terminationDate } from './contract-termination';
describe('contract termination cutoff', () => {
  const now = new Date('2026-10-05T15:00:00Z');
  it('preserves the paid cycle until midnight Recife, exclusively', () => {
    expect(terminationDate('2026-11-05', 9900, now).toISOString()).toBe(
      '2026-11-05T03:00:00.000Z',
    );
  });
  it('ends a free contract immediately without extending a free cycle', () => {
    expect(terminationDate('2026-11-05', 0, now)).toEqual(now);
  });
  it('allows ending a contract with no paid period, without forgiving its debt', () => {
    expect(terminationDate(null, null, now)).toEqual(now);
  });
  it('does not schedule termination in the past', () => {
    expect(terminationDate('2026-10-01', 9900, now)).toEqual(now);
  });
});
