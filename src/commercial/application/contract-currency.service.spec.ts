import { randomUUID } from 'node:crypto';
import { ContractCurrencyService } from './contract-currency.service';
import type { ContractRevisionRepositoryPort } from '../domain/contract-terms';
import type { BillingAdminClient } from '../../billing/billing-admin.client';
import type { ContractCommercialService } from './contract-commercial.service';
import type { ContractFinancialService } from './contract-financial.service';
describe('support currency scheduling', () => {
  const customer = randomUUID(),
    contract = randomUUID(),
    actor = randomUUID();
  const payload = {
    customerId: customer,
    contractId: contract,
    sourceRevisionId: randomUUID(),
    sourceVersion: 1,
    currency: 'BRL',
    planId: 'team',
    amount: 19900,
    setupAmount: 0,
    pricing: 'custom',
    priceVersionId: null,
    intervalMonths: 1,
    dueDay: 10,
    startsOn: '2026-01-01',
    endsOn: null,
    effectiveAt: '2026-01-01T03:00:00.000Z',
    reason: 'Original terms',
    allowedMethods: ['card', 'boleto', 'external'],
    entitlements: { maxEvents: 50000, deployment: 'cloud' },
    overage: { dlq_events: 2 },
  };
  const input = {
    currency: 'USD',
    requestedBy: 'Client ticket 123',
    reason: 'Client requested dollars',
    overage: { dlq_events: 1 },
  };
  let service: ContractCurrencyService;
  const repository = {
    contract: jest.fn(),
    current: jest.fn(),
    byKey: jest.fn(),
  };
  const billing = { request: jest.fn() },
    commercial = { publishConfirmedSnapshot: jest.fn() },
    financial = { get: jest.fn() };
  beforeEach(() => {
    jest.resetAllMocks();
    repository.contract.mockResolvedValue({ status: 'ativo' });
    repository.current.mockResolvedValue({
      id: payload.sourceRevisionId,
      sourceVersion: 1,
      status: 'synced',
      payload,
    });
    repository.byKey.mockResolvedValue(null);
    financial.get.mockResolvedValue({
      financial: { nextCycleOn: '2099-11-10', recurrenceState: 'active' },
    });
    billing.request.mockResolvedValue({
      current: {
        id: randomUUID(),
        amount: 4900,
        currency: 'USD',
        intervalMonths: 1,
      },
    });
    service = new ContractCurrencyService(
      repository as unknown as ContractRevisionRepositoryPort,
      billing as unknown as BillingAdminClient,
      commercial as unknown as ContractCommercialService,
      financial as unknown as ContractFinancialService,
    );
  });
  it('previews catalog amount, same limits and no USD boleto', async () => {
    const quote = await service.preview(customer, contract, input);
    expect(quote.amount).toBe(4900);
    expect(quote.target.entitlements).toEqual(payload.entitlements);
    expect(quote.target.allowedMethods).toEqual(['card', 'external']);
    expect(quote.effectiveAt).toBe('2099-11-10T03:00:00.000Z');
    expect(quote.target.currencyChange?.requestedBy).toBe(input.requestedBy);
  });
  it('requires explicit replacement rates', async () => {
    await expect(
      service.preview(customer, contract, { ...input, overage: {} }),
    ).rejects.toThrow();
  });
  it('rejects unavailable destination catalog', async () => {
    billing.request.mockResolvedValue({ current: null });
    await expect(service.preview(customer, contract, input)).rejects.toThrow();
  });
  it('rejects suspended recurrence', async () => {
    financial.get.mockResolvedValue({
      financial: { nextCycleOn: '2099-11-10', recurrenceState: 'paused' },
    });
    await expect(service.preview(customer, contract, input)).rejects.toThrow();
  });
  it('rejects stale preview before publishing', async () => {
    await expect(
      service.schedule(
        customer,
        contract,
        { ...input, expectedHash: 'a'.repeat(64) },
        actor,
        'ticket-123',
      ),
    ).rejects.toThrow();
    expect(commercial.publishConfirmedSnapshot).not.toHaveBeenCalled();
  });
  it('publishes confirmed quote with the operator identity', async () => {
    const quote = await service.preview(customer, contract, input);
    await service.schedule(
      customer,
      contract,
      { ...input, expectedHash: quote.hash },
      actor,
      'ticket-123',
    );
    expect(commercial.publishConfirmedSnapshot).toHaveBeenCalledWith(
      customer,
      contract,
      quote.target,
      actor,
      'ticket-123',
    );
  });
});
