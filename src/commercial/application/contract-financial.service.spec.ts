import type { ContractSnapshot } from '../domain/contract-terms';
import { ContractFinancialService } from './contract-financial.service';
import { env } from '../../config/env';

const customerId = '00000000-0000-4000-8000-000000000001';
const contractId = '00000000-0000-4000-8000-000000000002';
const uuid = '00000000-0000-4000-8000-000000000003';
function state(overdue: boolean, paid: boolean) {
  return {
    customerId,
    contractId,
    observedAt: new Date().toISOString(),
    overdueSince: overdue
      ? new Date(Date.now() - 9 * 86400000).toISOString()
      : null,
    paidThrough: paid ? '2099-01-01' : null,
    paidInvoiceId: paid ? uuid : null,
    paidTerms: paid
      ? {
          sourceRevisionId: uuid,
          sourceVersion: 1,
          customerId,
          contractId,
          planId: 'individual',
          priceVersionId: uuid,
          pricing: 'catalog',
          amount: 9900,
          setupAmount: 0,
          currency: 'BRL',
          intervalMonths: 1,
          dueDay: 1,
          allowedMethods: ['card'],
          startsOn: '2026-01-01',
          endsOn: null,
          effectiveAt: '2026-01-01T00:00:00Z',
          entitlements: { maxUsers: 1 },
          reason: 'Test fixture',
        }
      : null,
  };
}
function fixture(
  observations: ReturnType<typeof state>[],
  failDelivery = false,
) {
  let row: any = null;
  const query = jest.fn(async (sql: string, args: any[] = []) => {
    if (
      sql.includes('SELECT status') ||
      sql.includes('SELECT id FROM control.customer_contracts')
    )
      return [{ id: contractId, status: 'ativo' }];
    if (sql.includes('SELECT * FROM control.financial_decisions'))
      return row &&
        (!sql.includes("status='pending'") || row.status === 'pending')
        ? [row]
        : [];
    if (sql.startsWith('INSERT INTO control.financial_decisions'))
      row = {
        id: args[0],
        contract_id: contractId,
        customer_id: customerId,
        source_version: String(args[3]),
        payload: JSON.parse(args[4]),
        request_hash: args[5],
        status: args[6],
      };
    if (sql.includes("SET status='superseded' WHERE id"))
      row.status = 'superseded';
    if (sql.includes("SET status='synced'")) row.status = 'synced';
    if (sql.includes("SET status='observed'")) row.status = 'observed';
    return [];
  });
  const source = {
    query,
    transaction: jest.fn(async (fn: any) => fn({ query })),
  };
  let n = 0;
  const billing = {
    request: jest.fn(async (path: string, options: any) =>
      path.endsWith('/recurrence/financial-state')
        ? {
            contractId,
            sourceVersion: options.body.sourceVersion,
            nextCycleOn: null,
          }
        : observations[Math.min(n++, observations.length - 1)],
    ),
  };
  const licensing = {
    request: jest.fn(async () => {
      if (failDelivery) throw new Error('offline');
      return { contractId, sourceVersion: 1 };
    }),
  };
  const service = new ContractFinancialService(
    source as any,
    billing as any,
    licensing as any,
  );
  return { service, licensing, query, current: () => row };
}
describe('financial lifecycle delivery', () => {
  const enabled = env.FINANCIAL_SUSPENSION_ENABLED;
  beforeEach(() => {
    env.FINANCIAL_SUSPENSION_ENABLED = true;
  });
  afterEach(() => {
    env.FINANCIAL_SUSPENSION_ENABLED = enabled;
  });
  it('keeps an expired settled period suspended until renewal is paid', async () => {
    const expired = {
      ...state(false, true),
      paidThrough: '2020-01-01',
      recurrenceState: 'renewal_required',
    };
    const f = fixture([expired]);
    const result = await f.service.get(customerId, contractId);
    expect(result.access.effectiveState).toBe('payment_suspended');
    expect(result.access.renewalRequired).toBe(true);
    expect(result.financial.overdueSince).toBeNull();
  });
  it('allows a settled remaining paid period to recover', async () => {
    const f = fixture([{ ...state(false, true), recurrenceState: 'active' }]);
    const result = await f.service.get(customerId, contractId);
    expect(result.access.effectiveState).toBe('healthy');
    expect(result.access.renewalRequired).toBe(false);
  });
  it('persists financial restriction before the first confirmed payment', async () => {
    const f = fixture([state(true, false)]);
    const result = await f.service.process(customerId, contractId);
    expect(result.access.effectiveState).toBe('payment_suspended');
    expect(f.current().status).toBe('observed');
    expect(f.licensing.request).not.toHaveBeenCalled();
  });
  it('discards a suspension if payment arrives before delivery', async () => {
    const f = fixture([state(true, true), state(false, true)]);
    await f.service.process(customerId, contractId);
    expect(f.current().status).toBe('superseded');
    expect(f.licensing.request).not.toHaveBeenCalled();
  });
  it('retains an unavailable licensing delivery for retry', async () => {
    const financial = state(true, true);
    const f = fixture([financial], true);
    await f.service.process(customerId, contractId);
    expect(f.current().status).toBe('pending');
    expect(f.query).toHaveBeenCalledWith(
      expect.stringContaining("last_error='financial_lifecycle_pending'"),
      expect.any(Array),
    );
  });
});

describe('courtesy financial lifecycle', () => {
  const terms: ContractSnapshot = {
    sourceRevisionId: uuid,
    sourceVersion: 2,
    customerId,
    contractId,
    planId: 'enterprise',
    pricing: 'custom',
    priceVersionId: null,
    billingMode: 'courtesy',
    courtesyExpiresAt: null,
    amount: 0,
    setupAmount: 0,
    currency: 'BRL',
    intervalMonths: 1,
    dueDay: 1,
    allowedMethods: ['card'],
    startsOn: '2026-01-01',
    endsOn: null,
    effectiveAt: '2026-10-01T00:00:00Z',
    entitlements: { maxUsers: 'unlimited', aiEnabled: true },
    reason: 'Parceria',
  };
  it('delivers access without recording a payment or forgiving historical debt', async () => {
    const financial = {
      ...state(true, false),
      accessTerms: terms,
      accessUntil: '2099-01-01T00:00:00Z',
      courtesy: { active: true, expiresAt: null, reason: 'Parceria' },
    };
    const f = fixture([financial]);
    const result = await f.service.process(customerId, contractId);
    expect(result.access.effectiveState).toBe('healthy');
    expect(result.financial.paidTerms).toBeNull();
    expect(result.financial.overdueSince).toBe(financial.overdueSince);
    expect(f.current().payload).toMatchObject({
      recurrenceState: 'paused',
      graceDays: 0,
      entitlements: { courtesy: true, maxUsers: 'unlimited' },
    });
    expect(f.licensing.request).toHaveBeenCalled();
  });
  it('suspends expired courtesy even if there are no debts', async () => {
    const financial = {
      ...state(false, false),
      accessTerms: terms,
      accessUntil: '2026-01-01T00:00:00Z',
      courtesy: {
        active: false,
        expiresAt: '2026-01-01T00:00:00Z',
        reason: 'Parceria',
      },
    };
    const f = fixture([financial]);
    const result = await f.service.process(customerId, contractId);
    expect(result.access.effectiveState).toBe('payment_suspended');
    expect(f.current().payload).toMatchObject({
      state: 'suspended',
      recurrenceState: 'paused',
      graceDays: 0,
    });
  });
});
