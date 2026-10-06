import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import nodemailer from 'nodemailer';
import { env } from '../../config/env';
@Injectable()
export class ContractTerminationEmailWorker
  implements OnModuleInit, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly logger = new Logger(ContractTerminationEmailWorker.name);
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
    if (this.running || !env.MAIL_SMTP_HOST) return;
    this.running = true;
    try {
      for (let i = 0; i < 10; i++) {
        const [[row]] = await this.source.query<
          [
            {
              id: string;
              effective_at: Date;
              email_recipient: string;
              reason: string;
              email_attempts: number;
            }[],
            number,
          ]
        >(`UPDATE control.contract_terminations SET email_lease_until=now()+interval '2 minutes',email_attempts=email_attempts+1
          WHERE contract_id=(SELECT contract_id FROM control.contract_terminations WHERE email_recipient IS NOT NULL AND email_sent_at IS NULL AND email_next_attempt_at<=now() AND (email_lease_until IS NULL OR email_lease_until<now()) ORDER BY requested_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`);
        if (!row) break;
        try {
          const end = new Intl.DateTimeFormat('pt-BR', {
            dateStyle: 'short',
            timeStyle: 'short',
            timeZone: 'America/Recife',
          }).format(row.effective_at);
          await this.transport.sendMail({
            from: 'Rebound DLQ <no-reply@rebound-dlq.com>',
            replyTo: 'contato@rebound-dlq.com',
            to: row.email_recipient,
            messageId: `<termination-${row.id}@rebound-dlq.com>`,
            subject: 'Rebound DLQ: encerramento solicitado',
            text: `Seu pedido de encerramento foi registrado.\n\nData de término: ${end} (Recife).\nMotivo: ${row.reason}\nProtocolo: ${row.id}\n\nSeu período pago será preservado até essa data. Pagamentos anteriores continuam sujeitos à conciliação. Este pedido não exclui seu usuário nem seus dados.\n\nDúvidas: contato@rebound-dlq.com`,
          });
          await this.source.query(
            'UPDATE control.contract_terminations SET email_sent_at=now(),email_lease_until=NULL WHERE id=$1 AND email_attempts=$2',
            [row.id, row.email_attempts],
          );
        } catch {
          await this.source.query(
            `UPDATE control.contract_terminations SET email_lease_until=NULL,email_next_attempt_at=now()+interval '5 minutes' WHERE id=$1 AND email_attempts=$2`,
            [row.id, row.email_attempts],
          );
        }
      }
    } catch {
      this.logger.warn('Confirmações de encerramento aguardam entrega.');
    } finally {
      this.running = false;
    }
  }
}
