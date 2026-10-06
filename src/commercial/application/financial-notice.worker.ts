import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import nodemailer from 'nodemailer';
import { env } from '../../config/env';
import { BillingAdminClient } from '../../billing/billing-admin.client';
import { ContractFinancialService } from './contract-financial.service';
import { financialNotice } from '../domain/financial-notice';
interface Notice {
  id: string;
  customer_id: string;
  contract_id: string;
  access_state: string;
  attempts: number;
}
@Injectable()
export class FinancialNoticeWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly logger = new Logger(FinancialNoticeWorker.name);
  private readonly transport = nodemailer.createTransport({
    host: env.MAIL_SMTP_HOST,
    port: env.MAIL_SMTP_PORT,
    secure: env.MAIL_SMTP_SECURE,
    auth:
      env.MAIL_SMTP_USER && env.MAIL_SMTP_PASSWORD
        ? { user: env.MAIL_SMTP_USER, pass: env.MAIL_SMTP_PASSWORD }
        : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });
  constructor(
    private readonly source: DataSource,
    private readonly billing: BillingAdminClient,
    private readonly financial: ContractFinancialService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.run();
    }, 30000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.transport.close();
  }
  private async finish(row: Notice, status: 'sent' | 'superseded' | 'skipped') {
    await this.source.query(
      `UPDATE control.financial_notices SET status=$2,lease_until=NULL,last_error=NULL,sent_at=CASE WHEN $2='sent' THEN now() ELSE sent_at END WHERE id=$1 AND attempts=$3`,
      [row.id, status, row.attempts],
    );
  }
  async run() {
    if (this.running || !env.MAIL_SMTP_HOST) return;
    this.running = true;
    try {
      for (let i = 0; i < 10; i++) {
        const [[row]] = await this.source.query<
          [Notice[], number]
        >(`UPDATE control.financial_notices SET lease_until=now()+interval '2 minutes',attempts=attempts+1 WHERE id=(
          SELECT id FROM control.financial_notices WHERE status='pending' AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now())
          ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`);
        if (!row) break;
        try {
          const [contract] = await this.source.query<{ status: string }[]>(
            'SELECT status FROM control.customer_contracts WHERE id=$1',
            [row.contract_id],
          );
          const current = await this.financial.get(
            row.customer_id,
            row.contract_id,
          );
          if (
            contract?.status !== 'ativo' ||
            current.access.effectiveState !== row.access_state
          ) {
            await this.finish(row, 'superseded');
            continue;
          }
          const overview = await this.billing.request<{
            profile: { email: string; notificationsEnabled: boolean } | null;
          }>(`/financial/customers/${row.customer_id}`);
          if (
            !overview.profile?.email ||
            !overview.profile.notificationsEnabled
          ) {
            await this.finish(row, 'skipped');
            continue;
          }
          const portal = await this.billing.request<{ url: string }>(
            `/financial/customers/${row.customer_id}/access`,
            {
              method: 'POST',
              actorId: '00000000-0000-4000-8000-000000000005',
              body: { expiresInHours: 24 },
            },
          );
          // Payment could have arrived while the profile/access link was being fetched.
          const latest = await this.financial.get(
            row.customer_id,
            row.contract_id,
          );
          if (latest.access.effectiveState !== row.access_state) {
            await this.finish(row, 'superseded');
            continue;
          }
          await this.transport.sendMail({
            from: 'Rebound DLQ <no-reply@rebound-dlq.com>',
            replyTo: 'contato@rebound-dlq.com',
            to: overview.profile.email,
            messageId: `<financial-notice-${row.id}@rebound-dlq.com>`,
            ...financialNotice(
              row.access_state,
              portal.url,
              latest.access.restrictAt,
              latest.access.suspendAt,
            ),
          });
          await this.finish(row, 'sent');
        } catch {
          await this.source.query(
            `UPDATE control.financial_notices SET lease_until=NULL,last_error='delivery_pending',next_attempt_at=now()+interval '5 minutes' WHERE id=$1 AND attempts=$2`,
            [row.id, row.attempts],
          );
        }
      }
    } catch {
      this.logger.warn('Avisos financeiros aguardam entrega.');
    } finally {
      this.running = false;
    }
  }
}
