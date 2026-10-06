export const OPERATIONAL_RETENTION_DAYS = 30;
/** Retention starts at effective termination, including a future paid-period cutoff. */
export function operationalRetentionUntil(effectiveAt: Date): Date {
  if (!Number.isFinite(effectiveAt.getTime()))
    throw new Error('Invalid effective termination date');
  return new Date(
    effectiveAt.getTime() + OPERATIONAL_RETENTION_DAYS * 86400000,
  );
}
