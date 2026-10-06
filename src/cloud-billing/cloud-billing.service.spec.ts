import { BadRequestException } from '@nestjs/common';
import { CloudBillingService } from './cloud-billing.service';

type Dependencies = ConstructorParameters<typeof CloudBillingService>;

describe('Cloud plan eligibility', () => {
  const query = jest.fn();
  const bill = jest.fn();
  const license = jest.fn();
  const publish = jest.fn();
  const service = new CloudBillingService(
    { query } as unknown as Dependencies[0],
    { request: bill } as unknown as Dependencies[1],
    { request: license } as unknown as Dependencies[2],
    { publish } as unknown as Dependencies[3],
    {} as Dependencies[4],
    {} as Dependencies[5],
    { replay: jest.fn().mockResolvedValue(null) } as unknown as Dependencies[6],
  );
  beforeEach(() => {
    jest.resetAllMocks();
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
      '/commercial/plans/new-cloud-plan/prices',
    );
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
