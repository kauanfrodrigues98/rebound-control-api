import { operationalRetentionUntil } from './data-retention';
describe('operational data retention', () => {
  it('preserves 30 complete days from effective termination', () => {
    expect(
      operationalRetentionUntil(
        new Date('2026-10-20T00:00:00-03:00'),
      ).toISOString(),
    ).toBe('2026-11-19T03:00:00.000Z');
  });
  it('handles month boundaries without treating a month as 30 days', () => {
    expect(
      operationalRetentionUntil(new Date('2028-02-01T00:00:00Z')).toISOString(),
    ).toBe('2028-03-02T00:00:00.000Z');
  });
  it('rejects an invalid cutoff', () => {
    expect(() => operationalRetentionUntil(new Date('invalid'))).toThrow();
  });
});
