import { CloudBillingController } from './cloud-billing.controller';
import { CloudBillingService } from './cloud-billing.service';
import { RequestService } from '../requests/request.service';
describe('Cloud self-hosted request response', () => {
  const latest = jest.fn();
  const controller = new CloudBillingController(
    {} as CloudBillingService,
    { latest } as unknown as RequestService,
  );
  it('returns an explicit JSON object when no request exists', async () => {
    latest.mockResolvedValueOnce(null);
    expect(await controller.requestState('account')).toEqual({ request: null });
  });
  it('preserves an existing request inside the same response contract', async () => {
    const request = { id: 'request', status: 'new' };
    latest.mockResolvedValueOnce(request);
    expect(await controller.requestState('account')).toEqual({ request });
  });
});
