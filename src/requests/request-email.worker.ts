import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import nodemailer from 'nodemailer';
import { env } from '../config/env';
import type { SalesRequest } from './request.contracts';
@Injectable()
export class RequestEmailWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly logger = new Logger(RequestEmailWorker.name);
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
  constructor(private readonly source: DataSource) {}
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
  private async run() {
    if (
      this.running ||
      !env.SELF_HOSTED_REQUEST_EMAIL ||
      !env.MAIL_SMTP_HOST ||
      !env.MAIL_FROM_ADDRESS
    )
      return;
    this.running = true;
    try {
      for (let i = 0; i < 10; i++) {
        const [[row]] = await this.source.query<
          [SalesRequest[], number]
        >(`UPDATE control.self_hosted_requests SET email_state='sending',email_lease_until=now()+interval '2 minutes',email_attempts=email_attempts+1
          WHERE id=(SELECT id FROM control.self_hosted_requests WHERE
          (email_state='pending' AND email_next_attempt_at<=now()) OR (email_state='sending' AND email_lease_until<now())
          ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`);
        if (!row) break;
        try {
          await this.transport.sendMail({
            from: env.MAIL_FROM_ADDRESS,
            to: env.SELF_HOSTED_REQUEST_EMAIL,
            replyTo: row.contact_email,
            messageId: `<self-hosted-${row.id}@rebound.local>`,
            subject: 'Rebound: nova solicitação self-hosted',
            text: `Nova solicitação self-hosted\n\nContato: ${row.contact_name}\nE-mail: ${row.contact_email}\nTelefone: ${row.contact_phone || 'Não informado'}\n\n${row.message}\n\nAcompanhe no Control: ${env.CONTROL_FRONTEND_URL}/requests\nSolicitação: ${row.id}\nCliente: ${row.customer_id}`,
          });
          await this.source.query(
            "UPDATE control.self_hosted_requests SET email_state='sent',email_sent_at=now(),email_recipient=$2,email_error=NULL,email_lease_until=NULL WHERE id=$1 AND email_state='sending' AND email_attempts=$3",
            [row.id, env.SELF_HOSTED_REQUEST_EMAIL, row.email_attempts],
          );
        } catch {
          await this.source.query(
            `UPDATE control.self_hosted_requests SET email_state=$2,email_error='smtp_delivery_failed',email_lease_until=NULL,
            email_next_attempt_at=now()+($3*interval '1 minute') WHERE id=$1 AND email_state='sending' AND email_attempts=$4`,
            [
              row.id,
              row.email_attempts >= 5 ? 'failed' : 'pending',
              Math.min(60, 2 ** row.email_attempts),
              row.email_attempts,
            ],
          );
          this.logger.warn(
            'Aviso de solicitação pendente; consulte a fila no Control.',
          );
        }
      }
    } catch {
      this.logger.warn('Fila de solicitações indisponível.');
    } finally {
      this.running = false;
    }
  }
}
