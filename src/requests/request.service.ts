import { env } from '../config/env';
import { BadRequestException, Injectable } from '@nestjs/common';
import { requestInputSchema, requestStatusSchema } from './request.contracts';
import type { SalesRequest } from './request.contracts';
import { RequestRepository } from './request.repository';
@Injectable()
export class RequestService {
  constructor(private readonly repository: RequestRepository) {}
  cloudResponse(row: SalesRequest | null) {
    return row
      ? {
          id: row.id,
          status: row.status,
          createdAt: row.created_at,
          contactName: row.contact_name,
          contactEmail: row.contact_email,
          contactPhone: row.contact_phone,
        }
      : null;
  }
  async submit(account: string, body: unknown, key: string) {
    const parsed = requestInputSchema.safeParse(body);
    if (!parsed.success || !/^[A-Za-z0-9._:-]{1,80}$/.test(key ?? ''))
      throw new BadRequestException(
        'Informe nome, e-mail, mensagem e uma chave válida.',
      );
    return this.cloudResponse(
      await this.repository.submit(account, parsed.data, key),
    );
  }
  async latest(account: string) {
    return this.cloudResponse(await this.repository.latest(account));
  }
  async list(status: string | undefined, rawPage: string | undefined) {
    const page = Number(rawPage ?? 1);
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 100000 ||
      (status &&
        !['new', 'in_progress', 'completed', 'closed'].includes(status))
    )
      throw new BadRequestException('Filtros inválidos.');
    return {
      ...(await this.repository.list(status, page)),
      emailConfigured: !!(
        env.SELF_HOSTED_REQUEST_EMAIL &&
        env.MAIL_SMTP_HOST &&
        env.MAIL_FROM_ADDRESS
      ),
    };
  }
  update(id: string, body: unknown, actor: string) {
    const parsed = requestStatusSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('Informe o status e uma observação.');
    return this.repository.update(
      id,
      parsed.data.status,
      parsed.data.note,
      actor,
    );
  }
}
