import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { createHash } from 'node:crypto';
import type { RequestInput, SalesRequest } from './request.contracts';
@Injectable()
export class RequestRepository {
  constructor(private readonly source: DataSource) {}
  async submit(accountUuid: string, input: RequestInput, key: string) {
    const hash = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    return this.source.transaction(async (tx) => {
      const [binding] = await tx.query<Array<{ customer_id: string }>>(
        'SELECT customer_id FROM control.cloud_billing_bindings WHERE account_uuid=$1 FOR UPDATE',
        [accountUuid],
      );
      if (!binding)
        throw new NotFoundException('Conta cloud ainda não vinculada.');
      const [prior] = await tx.query<SalesRequest[]>(
        'SELECT * FROM control.self_hosted_requests WHERE account_uuid=$1 AND request_key=$2',
        [accountUuid, key],
      );
      if (prior) {
        if (
          (prior as SalesRequest & { request_hash: string }).request_hash !==
          hash
        )
          throw new ConflictException(
            'Esta chave já foi usada com outros dados.',
          );
        return prior;
      }
      const [pending] = await tx.query<SalesRequest[]>(
        "SELECT * FROM control.self_hosted_requests WHERE customer_id=$1 AND status IN ('new','in_progress')",
        [binding.customer_id],
      );
      if (pending) return pending;
      const [row] = await tx.query<SalesRequest[]>(
        `INSERT INTO control.self_hosted_requests
        (customer_id,account_uuid,contact_name,contact_email,contact_phone,message,request_key,request_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          binding.customer_id,
          accountUuid,
          input.contactName,
          input.contactEmail,
          input.contactPhone,
          input.message,
          key,
          hash,
        ],
      );
      await this.timeline(
        tx,
        row.customer_id,
        'Solicitação self-hosted recebida',
        `Solicitação ${row.id}\nContato: ${input.contactName} · ${input.contactEmail} · ${input.contactPhone || 'sem telefone'}\n${input.message}`,
      );
      return row;
    });
  }
  async latest(accountUuid: string) {
    const [row] = await this.source.query<SalesRequest[]>(
      'SELECT * FROM control.self_hosted_requests WHERE account_uuid=$1 ORDER BY created_at DESC LIMIT 1',
      [accountUuid],
    );
    return row ?? null;
  }
  async list(status: string | undefined, page: number) {
    const where = status ? 'WHERE r.status=$1' : '';
    const params: unknown[] = status ? [status] : [];
    const [count] = await this.source.query<Array<{ total: string }>>(
      `SELECT count(*) AS total FROM control.self_hosted_requests r ${where}`,
      params,
    );
    const rows = await this.source.query<
      Array<SalesRequest & { customer_name: string }>
    >(
      `SELECT r.id,r.customer_id,r.account_uuid,r.contact_name,r.contact_email,r.contact_phone,r.message,r.status,r.email_state,r.email_attempts,r.email_error,r.email_sent_at,r.created_at,r.updated_at,r.last_note,r.handled_by,c.name AS customer_name FROM control.self_hosted_requests r JOIN control.customers c ON c.id=r.customer_id
      ${where} ORDER BY r.created_at DESC,r.id DESC LIMIT 20 OFFSET $${params.length + 1}`,
      [...params, (page - 1) * 20],
    );
    return { requests: rows, total: Number(count.total), page, pageSize: 20 };
  }
  async update(id: string, status: string, note: string, actor: string) {
    return this.source.transaction(async (tx) => {
      const [row] = await tx.query<SalesRequest[]>(
        'SELECT * FROM control.self_hosted_requests WHERE id=$1 FOR UPDATE',
        [id],
      );
      if (!row) throw new NotFoundException('Solicitação não encontrada.');
      if (
        row.status === status &&
        (row as SalesRequest & { last_note: string }).last_note === note
      )
        return row;
      if (['completed', 'closed'].includes(row.status))
        throw new ConflictException('Solicitação já encerrada.');
      const [[updated]] = await tx.query<[SalesRequest[], number]>(
        'UPDATE control.self_hosted_requests SET status=$2,last_note=$3,handled_by=$4,updated_at=now() WHERE id=$1 RETURNING *',
        [id, status, note, actor],
      );
      await this.timeline(
        tx,
        row.customer_id,
        'Solicitação self-hosted atualizada',
        `Solicitação ${id} · ${{ in_progress: 'Em atendimento', completed: 'Concluída', closed: 'Encerrada sem contratação' }[status]}\n${note}\nResponsável: ${actor}`,
      );
      return updated;
    });
  }
  async retry(id: string) {
    const [[row]] = await this.source.query<[SalesRequest[], number]>(
      "UPDATE control.self_hosted_requests SET email_state='pending',email_attempts=0,email_error=NULL,email_next_attempt_at=now(),updated_at=now() WHERE id=$1 AND email_state='failed' RETURNING *",
      [id],
    );
    if (!row)
      throw new ConflictException(
        'Somente avisos com falha podem ser reenviados.',
      );
    return row;
  }
  private timeline(
    tx: EntityManager,
    customer: string,
    title: string,
    description: string,
  ) {
    return tx.query(
      "INSERT INTO control.customer_timeline_entries(customer_id,type,title,description) VALUES($1,'observacao',$2,$3)",
      [customer, title, description],
    );
  }
}
