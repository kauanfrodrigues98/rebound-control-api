import { receiptArchiveReady } from '../../cloud-billing/erasure-receipt';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { BillingAdminClient } from '../../billing/billing-admin.client';
import { LicensingAdminClient } from '../../infra/licensing/licensing-admin.client';
import { financialStateSchema } from './contract-financial.service';
import {
  operationalRetentionUntil,
  OPERATIONAL_RETENTION_DAYS,
} from '../domain/data-retention';
import { terminationDate } from '../domain/contract-termination';
interface Termination {
  id: string;
  contract_id: string;
  customer_id: string;
  actor_id: string;
  reason: string;
  request_key: string;
  effective_at: Date;
  requested_at: Date;
  status: 'scheduled' | 'completed';
  operational_erased_at?: Date | null;
  operational_retention_days?: number;
  operational_retention_until?: Date;
  billing_synced_at: Date | null;
  licensing_synced_at: Date | null;
  last_error: string | null;
}
@Injectable()
export class ContractTerminationService {
  constructor(
    private readonly source: DataSource,
    private readonly billing: BillingAdminClient,
    private readonly licensing: LicensingAdminClient,
  ) {}
  private present(row: Termination) {
    return {
      dataRetention: {
        archiveReady: receiptArchiveReady(),
        operationalErasedAt: row.operational_erased_at?.toISOString() ?? null,
        days: row.operational_retention_days ?? OPERATIONAL_RETENTION_DAYS,
        preserveUntil: (
          row.operational_retention_until ??
          operationalRetentionUntil(row.effective_at)
        ).toISOString(),
      },
      id: row.id,
      reason: row.reason,
      effectiveAt: row.effective_at.toISOString(),
      requestedAt: row.requested_at.toISOString(),
      status: row.status,
      deliveryPending: !row.billing_synced_at || !!row.last_error,
      accessEnded: row.effective_at <= new Date(),
    };
  }
  async get(customer: string, contract: string) {
    const [owner] = await this.source.query(
      'SELECT id FROM control.customer_contracts WHERE id=$1 AND customer_id=$2',
      [contract, customer],
    );
    if (!owner) throw new NotFoundException('Contrato não encontrado.');
    const [row] = await this.source.query<Termination[]>(
      'SELECT * FROM control.contract_terminations WHERE contract_id=$1',
      [contract],
    );
    return row ? this.present(row) : null;
  }
  async request(
    customer: string,
    contract: string,
    body: unknown,
    actor: string,
    key: string,
  ) {
    const input = z
      .object({
        reason: z.string().trim().min(3).max(1000),
        confirm: z.literal(true),
      })
      .strict()
      .safeParse(body);
    if (!input.success || !/^[A-Za-z0-9._:-]{1,80}$/.test(key ?? ''))
      throw new BadRequestException(
        'Confirme o encerramento, informe o motivo e uma chave válida.',
      );
    const row = await this.source.transaction(async (tx) => {
      const [owner] = await tx.query<{ status: string }[]>(
        'SELECT status FROM control.customer_contracts WHERE id=$1 AND customer_id=$2 FOR UPDATE',
        [contract, customer],
      );
      if (!owner) throw new NotFoundException('Contrato não encontrado.');
      const [existing] = await tx.query<Termination[]>(
        'SELECT * FROM control.contract_terminations WHERE contract_id=$1',
        [contract],
      );
      if (existing) {
        if (
          existing.request_key === key &&
          existing.reason !== input.data.reason
        )
          throw new ConflictException('Chave já utilizada para outro pedido.');
        return existing;
      }
      if (owner.status !== 'ativo')
        throw new ConflictException(
          'Somente contrato ativo pode ser encerrado por este fluxo.',
        );
      const financial = financialStateSchema.parse(
        await this.billing.request(
          `/commercial/contract-terms/${contract}/financial-state`,
        ),
      );
      if (
        financial.contractId !== contract ||
        financial.customerId !== customer
      )
        throw new ConflictException('Estado financeiro divergente.');
      const end = terminationDate(
        financial.paidThrough,
        financial.paidTerms?.amount ?? null,
      );
      const overview = await this.billing.request<{
        profile?: { email?: string } | null;
      }>(`/financial/customers/${customer}`);
      const [binding] = await tx.query<{ onboarding: { email: string } }[]>(
        'SELECT onboarding FROM control.cloud_billing_bindings WHERE contract_id=$1',
        [contract],
      );
      const [created] = await tx.query<Termination[]>(
        `INSERT INTO control.contract_terminations(id,contract_id,customer_id,actor_id,request_key,reason,effective_at,email_recipient,operational_retention_days,operational_retention_until)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          randomUUID(),
          contract,
          customer,
          actor,
          key,
          input.data.reason,
          end,
          overview.profile?.email || binding?.onboarding.email || null,
          OPERATIONAL_RETENTION_DAYS,
          operationalRetentionUntil(end),
        ],
      );
      await tx.query(
        `INSERT INTO control.customer_timeline_entries(id,customer_id,type,title,description) VALUES($1,$2,'contrato','Encerramento solicitado',$3)`,
        [
          randomUUID(),
          customer,
          `Contrato ${contract}. Término: ${end.toISOString()}. Motivo: ${input.data.reason}`,
        ],
      );
      return created;
    });
    // The request is durable even if a downstream service is temporarily unavailable.
    await this.process(contract);
    return (await this.get(customer, contract)) ?? this.present(row);
  }
  async process(contract: string) {
    try {
      await this.source.transaction(async (tx) => {
        const [owner] = await tx.query<{ status: string }[]>(
          'SELECT status FROM control.customer_contracts WHERE id=$1 FOR UPDATE',
          [contract],
        );
        const [row] = await tx.query<Termination[]>(
          `SELECT * FROM control.contract_terminations WHERE contract_id=$1 AND status='scheduled' FOR UPDATE`,
          [contract],
        );
        if (!owner || !row) return;
        if (!row.billing_synced_at) {
          const ack = await this.billing.request<{ id: string }>(
            `/commercial/contract-terms/${contract}/termination`,
            {
              method: 'POST',
              actorId: row.actor_id,
              key: row.id,
              body: {
                id: row.id,
                customerId: row.customer_id,
                effectiveAt: row.effective_at.toISOString(),
                reason: row.reason,
              },
            },
          );
          if (ack.id !== row.id) throw new Error('termination_ack_invalid');
          await tx.query(
            'UPDATE control.contract_terminations SET billing_synced_at=now(),last_error=NULL WHERE contract_id=$1',
            [contract],
          );
        }
        if (row.effective_at > new Date()) {
          await tx.query(
            `UPDATE control.contract_terminations SET next_attempt_at=effective_at WHERE contract_id=$1`,
            [contract],
          );
          return;
        }
        // Revoke before completing; retries must never re-open a terminated contract.
        await this.licensing.request(
          `/admin/licenses/contracts/${contract}/revoke`,
          { method: 'POST', body: { reason: row.reason } },
        );
        await tx.query(
          `UPDATE control.customer_contracts SET status='encerrado',updated_at=now() WHERE id=$1`,
          [contract],
        );
        await tx.query(
          'UPDATE control.contract_billing_enrollments SET enabled=false,next_cycle_on=NULL WHERE contract_id=$1',
          [contract],
        );
        await tx.query(
          `UPDATE control.contract_terminations SET status='completed',completed_at=now(),licensing_synced_at=now(),last_error=NULL WHERE contract_id=$1`,
          [contract],
        );
        await tx.query(
          `INSERT INTO control.customer_timeline_entries(id,customer_id,type,title,description) VALUES($1,$2,'contrato','Contrato encerrado',$3)`,
          [
            randomUUID(),
            row.customer_id,
            `Contrato ${contract}. Usuários, eventos e histórico preservados.`,
          ],
        );
      });
    } catch {
      await this.source.query(
        `UPDATE control.contract_terminations SET attempts=attempts+1,last_error='termination_delivery_pending',next_attempt_at=now()+interval '1 minute' WHERE contract_id=$1 AND status='scheduled'`,
        [contract],
      );
    }
  }
  async run() {
    const rows = await this.source.query<{ contract_id: string }[]>(
      `SELECT contract_id FROM control.contract_terminations WHERE status='scheduled' AND next_attempt_at<=now() ORDER BY next_attempt_at LIMIT 25`,
    );
    for (const row of rows) await this.process(row.contract_id);
  }
}
