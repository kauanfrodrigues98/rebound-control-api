import { BadRequestException } from '@nestjs/common';
import { CloudBillingService } from './cloud-billing.service';

type Dependencies = ConstructorParameters<typeof CloudBillingService>;

describe('Cloud plan eligibility', () => {
  const query = jest.fn();
  const bill = jest.fn();
  const license = jest.fn();
  const publish = jest.fn();
  const list = jest.fn();
  const service = new CloudBillingService(
    { query } as unknown as Dependencies[0],
    { request: bill } as unknown as Dependencies[1],
    { request: license } as unknown as Dependencies[2],
    { publish, list } as unknown as Dependencies[3],
    {} as Dependencies[4],
    {} as Dependencies[5],
    { replay: jest.fn().mockResolvedValue(null) } as unknown as Dependencies[6],
    {} as Dependencies[7],
  );
  beforeEach(() => {
    jest.clearAllMocks();
    list.mockResolvedValue({ current: { terms: { currency: 'BRL' } } });
    license.mockResolvedValue({
      plans: [
        { id: 'new-cloud-plan', active: true, deployment: 'cloud' },
        { id: 'private-installation', active: true, deployment: 'self_hosted' },
        { id: 'disabled-cloud', active: false, deployment: 'cloud' },
      ],
    });
    bill.mockResolvedValue({
      current: { id: 'price', amount: 100, currency: 'BRL', intervalMonths: 1 },
    });
  });
  it('lists new Cloud IDs and excludes self-hosted and inactive plans before fetching prices', async () => {
    expect((await service.plans()).plans.map((plan) => plan.id)).toEqual([
      'new-cloud-plan',
    ]);
    expect(bill).toHaveBeenCalledTimes(1);
    expect(bill).toHaveBeenCalledWith(
      '/commercial/plans/new-cloud-plan/prices?currency=BRL',
    );
  });
  it('selects a separate USD price book', async () => {
    await service.plans('USD');
    expect(bill).toHaveBeenCalledWith(
      '/commercial/plans/new-cloud-plan/prices?currency=USD',
    );
  });
  it('retries USD onboarding with USD terms and card-only payment methods', async () => {
    const row = {
      account_uuid: 'account',
      customer_id: 'customer',
      contract_id: 'contract',
      onboarding: {
        name: 'USD Company',
        email: 'owner@example.invalid',
        currency: 'USD',
        planId: 'free',
        priceId: 'usd-free',
        startsOn: '2026-10-09',
        effectiveAt: new Date().toISOString(),
        dueDay: 9,
      },
    };
    query.mockResolvedValue([row]);
    list.mockResolvedValueOnce({ versions: [] });
    publish.mockRejectedValueOnce(new Error('Stop after initial publish'));
    await expect(
      service.provision('account', {
        name: 'USD Company',
        email: 'owner@example.invalid',
        currency: 'USD',
      }),
    ).rejects.toThrow('Stop after initial publish');
    expect(publish).toHaveBeenCalledWith(
      'customer',
      'contract',
      expect.objectContaining({
        currency: 'USD',
        planId: 'free',
        priceVersionId: 'usd-free',
        allowedMethods: ['card'],
      }),
      expect.any(String),
      expect.any(String),
    );
  });
  it('rejects unsupported registration currencies before provisioning', async () => {
    await expect(
      service.provision('account', {
        name: 'Company',
        email: 'owner@example.invalid',
        currency: 'EUR',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });
  it('does not offer a Cloud plan without a current price', async () => {
    bill.mockResolvedValue({ current: null });
    expect((await service.plans()).plans).toEqual([]);
  });
  it('rejects a forged self-hosted upgrade before changing the contract', async () => {
    query.mockResolvedValue([
      {
        account_uuid: 'account',
        customer_id: 'customer',
        contract_id: 'contract',
      },
    ]);
    await expect(
      service.change(
        'account',
        { planId: 'private-installation' },
        'test-request',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(publish).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
