import { CloudPlanChangeService } from './cloud-plan-change.service';
type Dependencies = ConstructorParameters<typeof CloudPlanChangeService>;
describe('Scheduled Cloud downgrade', () => {
  const row = {
    id: 'change',
    customer_id: 'customer',
    contract_id: 'contract',
    kind: 'downgrade',
    status: 'scheduled',
    target: { effectiveAt: '2026-11-10T00:00:00-03:00' },
    quote: { endsOn: '2026-11-10' },
  };
  const query = jest.fn();
  const publish = jest.fn();
  const process = jest.fn();
  const get = jest.fn();
  const financial = jest.fn();
  const service = new CloudPlanChangeService(
    { query } as unknown as Dependencies[0],
    {} as Dependencies[1],
    { publishConfirmedSnapshot: publish } as unknown as Dependencies[2],
    { process, get } as unknown as Dependencies[3],
    { process: financial } as unknown as Dependencies[4],
    {} as Dependencies[5],
  );
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    query.mockResolvedValue([]);
    query.mockResolvedValueOnce([[row], 1]);
    publish.mockResolvedValue({ id: 'revision', status: 'synced' });
    get.mockResolvedValue({ nextCycleOn: '2026-12-10' });
  });
  afterEach(() => jest.useRealTimers());
  it('preserves the paid period and does not process a renewal before the scheduled date', async () => {
    jest.setSystemTime(new Date('2026-10-20T12:00:00-03:00'));
    await service.process('change');
    expect(process).not.toHaveBeenCalled();
    expect(financial).not.toHaveBeenCalled();
  });
  it('processes renewal and financial synchronization at the paid period boundary', async () => {
    jest.setSystemTime(new Date('2026-11-10T00:00:00-03:00'));
    await service.process('change');
    expect(process).toHaveBeenCalledWith('customer', 'contract');
    expect(financial).toHaveBeenCalledWith('customer', 'contract');
  });
});
