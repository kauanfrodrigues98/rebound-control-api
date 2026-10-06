export const FINANCIAL_RESTRICT_AFTER_DAYS = 4;
export const FINANCIAL_SUSPEND_AFTER_DAYS = 8;
const DAY_MS = 86400000;
export type FinancialAccessState =
  'healthy' | 'payment_attention' | 'payment_restricted' | 'payment_suspended';

export const FINANCIAL_ACCESS_LABELS: Record<FinancialAccessState, string> = {
  healthy: 'Regular',
  payment_attention: 'Pagamento em atraso',
  payment_restricted: 'Uso restrito por inadimplência',
  payment_suspended: 'Uso suspenso por inadimplência',
};

/** Durations are complete 24-hour intervals measured from the invoice due time. */
export function financialAccess(
  overdueSince: string | null,
  enforcementEnabled: boolean,
  now = new Date(),
) {
  const due = overdueSince === null ? null : new Date(overdueSince);
  if (due && !Number.isFinite(due.getTime()))
    throw new Error('Invalid overdue timestamp');
  const overdue = due !== null && due.getTime() <= now.getTime();
  const daysPastDue = overdue
    ? Math.floor((now.getTime() - due!.getTime()) / DAY_MS)
    : null;
  const state: FinancialAccessState = !overdue
    ? 'healthy'
    : daysPastDue! >= FINANCIAL_SUSPEND_AFTER_DAYS
      ? 'payment_suspended'
      : daysPastDue! >= FINANCIAL_RESTRICT_AFTER_DAYS
        ? 'payment_restricted'
        : 'payment_attention';
  return {
    state,
    effectiveState: enforcementEnabled
      ? state
      : ('healthy' as FinancialAccessState),
    enforcementEnabled,
    daysPastDue,
    overdueSince: overdue ? due!.toISOString() : null,
    restrictAt: overdue
      ? new Date(
          due!.getTime() + FINANCIAL_RESTRICT_AFTER_DAYS * DAY_MS,
        ).toISOString()
      : null,
    suspendAt: overdue
      ? new Date(
          due!.getTime() + FINANCIAL_SUSPEND_AFTER_DAYS * DAY_MS,
        ).toISOString()
      : null,
  };
}
