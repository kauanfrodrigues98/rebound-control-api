import type { DataSource } from 'typeorm';
import type { ContractCommercialService } from './contract-commercial.service';
import type { LicensingAdminClient } from '../../infra/licensing/licensing-admin.client';
import type { ContractSnapshot } from '../domain/contract-terms';
import { ContractCourtesyExpiryService } from './contract-courtesy-expiry.service';
import { env } from '../../config/env';

const terms: ContractSnapshot = {
  sourceRevisionId: '00000000-0000-4000-8000-000000000001',
  sourceVersion: 2,
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
  dueDay: 4,
  allowedMethods: ['card', 'boleto'],
  startsOn: '2026-01-01',
  endsOn: null,
  effectiveAt: '2026-01-01T03:00:00Z',
  courtesyExpiresAt: '2026-10-01T03:00:00Z',
  entitlements: { maxUsers: 'unlimited', aiEnabled: true },
  reason: 'Parceria',
};
function fixture() {
  const query = jest
    .fn()
    .mockResolvedValue([
      {
        customer_id: terms.customerId,
        contract_id: terms.contractId,
        payload: terms,
      },
    ]);
  const publishConfirmedSnapshot = jest.fn<
    ReturnType<ContractCommercialService['publishConfirmedSnapshot']>,
    Parameters<ContractCommercialService['publishConfirmedSnapshot']>
  >();
  const request = jest.fn().mockResolvedValue({
    plans: [
      {
        id: env.CLOUD_DEFAULT_PLAN_ID,
        name: 'Free',
        cadence: 'monthly',
        active: true,
        deployment: 'cloud',
        entitlements: { maxUsers: 1, aiEnabled: false },
      },
    ],
  });
  const service = new ContractCourtesyExpiryService(
    { query } as unknown as DataSource,
    { publishConfirmedSnapshot } as unknown as ContractCommercialService,
    { request } as unknown as LicensingAdminClient,
  );
  return { service, query, publishConfirmedSnapshot, request };
}
describe('Cloud courtesy expiration', () => {
  it('returns to Free without carrying gifted permissions or charging, with deterministic retries', async () => {
    const f = fixture();
    await f.service.run();
    await f.service.run();
    expect(f.publishConfirmedSnapshot).toHaveBeenCalledTimes(2);
    expect(f.publishConfirmedSnapshot.mock.calls[0]).toEqual(
      f.publishConfirmedSnapshot.mock.calls[1],
    );
    const snapshot = f.publishConfirmedSnapshot.mock.calls[0][2];
    expect(snapshot).toMatchObject({
      billingMode: 'standard',
      courtesyExpiresAt: null,
      courtesyEndedAt: terms.courtesyExpiresAt,
      amount: 0,
      setupAmount: 0,
      planId: env.CLOUD_DEFAULT_PLAN_ID,
      effectiveAt: '2026-10-01T03:00:00.001Z',
      entitlements: { maxUsers: 1, aiEnabled: false, deployment: 'cloud' },
    });
  });
  it('does not fetch catalog or change contracts without expired courtesy', async () => {
    const f = fixture();
    f.query.mockResolvedValue([]);
    await f.service.run();
    expect(f.request).not.toHaveBeenCalled();
    expect(f.publishConfirmedSnapshot).not.toHaveBeenCalled();
  });
  it('keeps a failed expiration retryable', async () => {
    const f = fixture();
    f.publishConfirmedSnapshot.mockRejectedValueOnce(new Error('offline'));
    await expect(f.service.run()).resolves.toBeUndefined();
    await f.service.run();
    expect(f.publishConfirmedSnapshot).toHaveBeenCalledTimes(2);
  });
});
