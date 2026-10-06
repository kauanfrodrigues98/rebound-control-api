import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { z } from 'zod';
import { BillingAdminClient } from '../../billing/billing-admin.client';
interface Cancellation {
  revision_id: string;
  contract_id: string;
  payload: { contractId: string; cancelledAt: string; reason: string };
  actor_id: string;
  status: string;
}
@Injectable()
export class ContractCancellationService {
  constructor(
    private readonly source: DataSource,
    private readonly billing: BillingAdminClient,
  ) {}
  async cancel(
    customerId: string,
    contractId: string,
    revisionId: string,
    body: unknown,
    actorId: string,
  ) {
    const parsed = z
      .object({ reason: z.string().trim().min(3).max(1000) })
      .strict()
      .safeParse(body);
    if (!parsed.success || !z.uuid().safeParse(actorId).success)
      throw new BadRequestException('Motivo obrigatório.');
    await this.source.transaction(async (tx) => {
      const [contract] = await tx.query<Array<{ id: string }>>(
        'SELECT id FROM control.customer_contracts WHERE id=$1 AND customer_id=$2 FOR UPDATE',
        [contractId, customerId],
      );
      if (!contract) throw new NotFoundException('Contrato não encontrado.');
      const [prior] = await tx.query<Cancellation[]>(
        'SELECT * FROM control.commercial_cancellations WHERE revision_id=$1',
        [revisionId],
      );
      if (prior) return;
      const [revision] = await tx.query<
        Array<{ payload: { effectiveAt: string }; lease_until: Date | null }>
      >(
        'SELECT payload,lease_until FROM control.contract_commercial_revisions WHERE id=$1 AND contract_id=$2 FOR UPDATE',
        [revisionId, contractId],
      );
      if (!revision) throw new NotFoundException('Revisão não encontrada.');
      if (new Date(revision.payload.effectiveAt) <= new Date())
        throw new ConflictException(
          'Somente revisões futuras podem ser canceladas.',
        );
      const payload = {
        contractId,
        cancelledAt: new Date().toISOString(),
        reason: parsed.data.reason,
      };
      await tx.query(
        'UPDATE control.contract_commercial_revisions SET cancelled_at=$2 WHERE id=$1',
        [revisionId, payload.cancelledAt],
      );
      await tx.query(
        'INSERT INTO control.commercial_cancellations(revision_id,contract_id,payload,actor_id) VALUES($1,$2,$3,$4)',
        [revisionId, contractId, JSON.stringify(payload), actorId],
      );
    });
    await this.deliver(revisionId);
    return { revisionId, cancelled: true };
  }
  async deliver(id?: string) {
    return this.source.transaction(async (tx) => {
      const [row] = await tx.query<Cancellation[]>(
        `SELECT * FROM control.commercial_cancellations WHERE status='pending' AND ($1::uuid IS NULL OR revision_id=$1) AND ($1::uuid IS NOT NULL OR next_attempt_at<=now()) ORDER BY next_attempt_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [id ?? null],
      );
      if (!row) return false;
      try {
        await this.billing.request(
          `/commercial/contract-terms/${row.revision_id}/cancel`,
          { method: 'POST', body: row.payload, actorId: row.actor_id },
        );
        await tx.query(
          `UPDATE control.commercial_cancellations SET status='synced' WHERE revision_id=$1`,
          [row.revision_id],
        );
      } catch {
        await tx.query(
          `UPDATE control.commercial_cancellations SET next_attempt_at=now()+interval '5 minutes' WHERE revision_id=$1`,
          [row.revision_id],
        );
      }
      return true;
    });
  }
}
