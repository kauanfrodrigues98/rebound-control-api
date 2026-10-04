import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FinancialPortalController } from './financial-portal.controller';
import { BillingControlController } from './billing-control.controller';
import { BillingAdminClient } from './billing-admin.client';
import { AuthGuard } from '../infra/security/auth.guard';
import {
  FinancialOperatorGuard,
  FinancialOriginGuard,
} from './financial-access.guard';
const actorId = '019a0671-abc0-7000-8000-000000000002';
const token = 'a'.repeat(43);
describe('Financial Control boundaries', () => {
  let app: INestApplication<Server>;
  const billing = {
    request: jest.fn().mockResolvedValue({
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      customerName: 'Cliente',
    }),
    document: jest.fn(),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [FinancialPortalController, BillingControlController],
      providers: [
        { provide: BillingAdminClient, useValue: billing },
        FinancialOperatorGuard,
        FinancialOriginGuard,
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate(context: {
          switchToHttp: () => {
            getRequest: () => {
              headers: Record<string, string>;
              user?: object;
            };
          };
        }) {
          const request = context.switchToHttp().getRequest();
          if (!request.headers['test-role']) return false;
          request.user = { id: actorId, role: request.headers['test-role'] };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  afterAll(async () => app.close());
  beforeEach(() => billing.request.mockClear());
  it('exchanges access only from the configured origin and issues an HttpOnly cookie', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/financial-portal/session')
      .set('Origin', 'http://localhost:3020')
      .send({ token })
      .expect(200);
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Lax');
    expect(JSON.stringify(response.body)).not.toContain(token);
  });
  it('rejects foreign origins and malformed credentials without calling Billing', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/financial-portal/session')
      .set('Origin', 'https://attacker.example')
      .send({ token })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/financial-portal/session')
      .set('Origin', 'http://localhost:3020')
      .send({ token: 'bad' })
      .expect(400);
    expect(billing.request).not.toHaveBeenCalled();
  });
  it('does not substitute an operator session for a customer credential', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/financial-portal/invoices')
      .set('Cookie', 'rebound_control_access=operator-token')
      .expect(401);
    expect(billing.request).not.toHaveBeenCalled();
  });
  it('passes a scoped financial cookie only through the private client', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/financial-portal/invoices')
      .set('Cookie', `rebound_financial_access=${token}`)
      .expect(200);
    expect(billing.request).toHaveBeenCalledWith(
      '/financial/portal/invoices?page=1',
      { access: token },
    );
  });
  it('blocks unauthenticated administrative reads and operator mutations', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/billing/customers/${actorId}`)
      .expect(403);
    await request(app.getHttpServer())
      .put(`/api/v1/billing/customers/${actorId}/profile`)
      .set('test-role', 'operator')
      .set('Origin', 'http://localhost:3020')
      .send({})
      .expect(403);
    expect(billing.request).not.toHaveBeenCalled();
  });
  it('derives the financial operator from the authenticated session', async () => {
    await request(app.getHttpServer())
      .put(`/api/v1/billing/customers/${actorId}/profile`)
      .set('test-role', 'admin')
      .set('Origin', 'http://localhost:3020')
      .set('x-operator-id', 'forged')
      .send({ name: 'Cliente' })
      .expect(200);
    expect(billing.request).toHaveBeenCalledWith(
      `/financial/customers/${actorId}/profile`,
      { method: 'PUT', body: { name: 'Cliente' }, actorId },
    );
  });
  it('blocks administrative writes without Origin', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/billing/customers/${actorId}/access`)
      .set('test-role', 'admin')
      .send({ expiresInHours: 24 })
      .expect(403);
    expect(billing.request).not.toHaveBeenCalled();
  });
});
