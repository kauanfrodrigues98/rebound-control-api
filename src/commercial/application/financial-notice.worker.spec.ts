import { FinancialNoticeWorker } from './financial-notice.worker';
import { env } from '../../config/env';
const sendMail = jest.fn(async () => ({}));
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: () => ({
      sendMail: (...args: any[]) => sendMail(...args),
      close: () => {},
    }),
  },
}));
function fixture(currentState = 'healthy', enabled = true) {
  let claimed = false;
  const row = {
    id: 'notice-test',
    customer_id: 'customer-test',
    contract_id: 'contract-test',
    access_state: 'healthy',
    attempts: 1,
  };
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('RETURNING *')) {
      if (claimed) return [[], 0];
      claimed = true;
      return [[row], 1];
    }
    if (sql.includes('SELECT status')) return [{ status: 'ativo' }];
    return [];
  });
  const billing = {
    request: jest.fn(async (path: string) =>
      path.endsWith('/access')
        ? { url: 'https://example.invalid/financial' }
        : {
            profile: {
              email: 'customer@example.invalid',
              notificationsEnabled: enabled,
            },
          },
    ),
  };
  const financial = {
    get: async () => ({
      access: {
        effectiveState: currentState,
        restrictAt: null,
        suspendAt: null,
      },
    }),
  };
  return {
    worker: new FinancialNoticeWorker(
      { query } as any,
      billing as any,
      financial as any,
    ),
    query,
    billing,
  };
}
describe('financial notices', () => {
  const host = env.MAIL_SMTP_HOST;
  beforeEach(() => {
    env.MAIL_SMTP_HOST = 'test';
    sendMail.mockClear();
  });
  afterEach(() => {
    env.MAIL_SMTP_HOST = host;
  });
  it('sends the notice from no-reply and records completion', async () => {
    const f = fixture();
    await f.worker.run();
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Rebound DLQ <no-reply@rebound-dlq.com>',
        replyTo: 'contato@rebound-dlq.com',
      }),
    );
    expect(f.query).toHaveBeenCalledWith(
      expect.stringContaining('SET status=$2'),
      ['notice-test', 'sent', 1],
    );
  });
  it('does not send stale notices or override notification preferences', async () => {
    const stale = fixture('payment_restricted');
    await stale.worker.run();
    expect(sendMail).not.toHaveBeenCalled();
    const disabled = fixture('healthy', false);
    await disabled.worker.run();
    expect(sendMail).not.toHaveBeenCalled();
    expect(disabled.query).toHaveBeenCalledWith(
      expect.stringContaining('SET status=$2'),
      ['notice-test', 'skipped', 1],
    );
  });
});
