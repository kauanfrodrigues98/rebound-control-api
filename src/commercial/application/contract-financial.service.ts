import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { BillingAdminClient } from '../../billing/billing-admin.client';
import { LicensingAdminClient } from '../../infra/licensing/licensing-admin.client';
import { contractSnapshotSchema } from '../domain/contract-terms';
import { env } from '../../config/env';
export const financialStateSchema = z
  .object({
    contractId: z.uuid(),
    customerId: z.uuid(),
    overdueSince: z.iso.datetime({ offset: true }).nullable(),
    paidThrough: z.iso.date().nullable(),
    paidInvoiceId: z.uuid().nullable(),
    paidTerms: contractSnapshotSchema.nullable(),
    observedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
interface Decision {
  id: string;
  customer_id: string;
  contract_id: string;
  source_version: string;
  payload: Record<string, unknown>;
  request_hash: string;
  status: string;
}
@Injectable()
export class ContractFinancialService {
  private cursor = '00000000-0000-0000-0000-000000000000';
  constructor(
    private readonly source: DataSource,
    private readonly billing: BillingAdminClient,
    private readonly licensing: LicensingAdminClient,
  ) {}
  async licensePeriod(customerId: string, contractId: string) {
    const [row] = await this.source.query<Array<{ id: string }>>(
      'SELECT id FROM control.contract_billing_enrollments WHERE contract_id=$1',
      [contractId],
    );
    if (!row) return null;
    const { financial } = await this.get(customerId, contractId);
    if (
      !financial.paidTerms ||
      !financial.paidThrough ||
      financial.overdueSince ||
      new Date(`${financial.paidThrough}T00:00:00.000-03:00`) <= new Date()
    )
      throw new ConflictException(
        'Confirme o pagamento da competência antes de emitir a licença.',
      );
    return {
      terms: financial.paidTerms,
      validUntil: `${financial.paidThrough}T00:00:00.000-03:00`,
    };
  }
  async get(customerId: string, contractId: string) {
    const [contract] = await this.source.query<Array<{ id: string }>>(
      'SELECT id FROM control.customer_contracts WHERE id=$1 AND customer_id=$2',
      [contractId, customerId],
    );
    if (!contract) throw new NotFoundException('Contrato não encontrado.');
    const state = financialStateSchema.parse(
      await this.billing.request(
        `/commercial/contract-terms/${contractId}/financial-state`,
      ),
    );
    if (state.customerId !== customerId || state.contractId !== contractId)
      throw new ConflictException(
        'Estado financeiro pertence a outro contrato.',
      );
    const [decision] = await this.source.query<Decision[]>(
      `SELECT * FROM control.financial_decisions WHERE contract_id=$1 ORDER BY source_version DESC LIMIT 1`,
      [contractId],
    );
    return {
      financial: state,
      decision: decision
        ? {
            id: decision.id,
            sourceVersion: Number(decision.source_version),
            status: decision.status,
            state: decision.payload.state,
          }
        : null,
    };
  }
  async process(customerId: string, contractId: string) {
    await this.source.transaction(async (tx) => {
      const [contract] = await tx.query<Array<{ status: string }>>(
        'SELECT status FROM control.customer_contracts WHERE id=$1 AND customer_id=$2 FOR UPDATE',
        [contractId, customerId],
      );
      if (!contract) throw new NotFoundException('Contrato não encontrado.');
      if (contract.status !== 'ativo') return;
      const financial = financialStateSchema.parse(
        await this.billing.request(
          `/commercial/contract-terms/${contractId}/financial-state`,
        ),
      );
      if (
        financial.contractId !== contractId ||
        financial.customerId !== customerId
      )
        throw new ConflictException('Estado financeiro divergente.');
      if (!financial.paidTerms || !financial.paidThrough) return;
      const validUntil = new Date(
        `${financial.paidThrough}T00:00:00.000-03:00`,
      );
      const overdueDays = financial.overdueSince
        ? Math.max(
            0,
            (Date.now() - new Date(financial.overdueSince).getTime()) /
              86400000,
          )
        : 0;
      const suspended =
        env.FINANCIAL_SUSPENSION_ENABLED &&
        overdueDays >= env.FINANCIAL_GRACE_DAYS;
      if (!suspended && (validUntil <= new Date() || financial.overdueSince))
        return;
      const core = {
        customerId,
        state: suspended ? 'suspended' : 'active',
        validUntil: validUntil.toISOString(),
        graceDays: env.FINANCIAL_GRACE_DAYS,
        entitlements: {
          ...financial.paidTerms.entitlements,
          commercialRevisionId: financial.paidTerms.sourceRevisionId,
          commercialVersion: financial.paidTerms.sourceVersion,
        },
      };
      const hash = createHash('sha256')
        .update(JSON.stringify(core))
        .digest('hex');
      const [prior] = await tx.query<Decision[]>(
        `SELECT * FROM control.financial_decisions WHERE contract_id=$1 ORDER BY source_version DESC LIMIT 1`,
        [contractId],
      );
      if (prior?.request_hash === hash && prior.status !== 'superseded') return;
      const version = Number(prior?.source_version ?? 0) + 1;
      await tx.query(
        `UPDATE control.financial_decisions SET status='superseded' WHERE contract_id=$1 AND status='pending'`,
        [contractId],
      );
      await tx.query(
        `INSERT INTO control.financial_decisions(id,contract_id,customer_id,source_version,payload,request_hash) VALUES($1,$2,$3,$4,$5,$6)`,
        [
          randomUUID(),
          contractId,
          customerId,
          version,
          JSON.stringify({ ...core, sourceVersion: version }),
          hash,
        ],
      );
    });
    await this.deliver(contractId);
    return this.get(customerId, contractId);
  }
  async deliver(contractId: string) {
    return this.source.transaction(async (tx) => {
      const [contract] = await tx.query<Array<{ status: string }>>(
        'SELECT status FROM control.customer_contracts WHERE id=$1 FOR UPDATE',
        [contractId],
      );
      if (!contract || contract.status !== 'ativo') return;
      const [row] = await tx.query<Decision[]>(
        `SELECT * FROM control.financial_decisions WHERE contract_id=$1 AND status='pending' AND next_attempt_at<=now() ORDER BY source_version LIMIT 1 FOR UPDATE`,
        [contractId],
      );
      if (!row) return;
      if (row.payload.state === 'active') {
        const state = financialStateSchema.parse(
          await this.billing.request(
            `/commercial/contract-terms/${contractId}/financial-state`,
          ),
        );
        if (
          state.customerId !== row.customer_id ||
          state.contractId !== contractId
        )
          throw new ConflictException('Estado financeiro divergente.');
        if (
          state.overdueSince ||
          !state.paidThrough ||
          !state.paidTerms ||
          new Date(`${state.paidThrough}T00:00:00.000-03:00`) <= new Date() ||
          new Date(`${state.paidThrough}T00:00:00.000-03:00`).toISOString() !==
            row.payload.validUntil ||
          state.paidTerms.sourceRevisionId !==
            (row.payload.entitlements as Record<string, unknown>)
              .commercialRevisionId
        ) {
          await tx.query(
            `UPDATE control.financial_decisions SET status='superseded' WHERE id=$1`,
            [row.id],
          );
          return;
        }
      }
      try {
        const ack = await this.licensing.request<{
          contractId: string;
          sourceVersion: number;
        }>(`/admin/licenses/contracts/${contractId}/financial-state`, {
          method: 'POST',
          body: row.payload,
        });
        if (
          ack.contractId !== contractId ||
          ack.sourceVersion !== Number(row.source_version)
        )
          throw new Error('Invalid lifecycle acknowledgement');
        await tx.query(
          `UPDATE control.financial_decisions SET status='synced',last_error=NULL WHERE id=$1`,
          [row.id],
        );
      } catch {
        await tx.query(
          `UPDATE control.financial_decisions SET attempts=attempts+1,last_error='licensing_pending',next_attempt_at=now()+interval '5 minutes' WHERE id=$1`,
          [row.id],
        );
      }
    });
  }
  async run() {
    const rows = await this.source.query<
      Array<{ customer_id: string; contract_id: string }>
    >(
      `SELECT e.customer_id,e.contract_id FROM control.contract_billing_enrollments e JOIN control.customer_contracts c ON c.id=e.contract_id WHERE c.status='ativo' AND e.contract_id>$1 ORDER BY e.contract_id LIMIT 25`,
      [this.cursor],
    );
    if (!rows.length) this.cursor = '00000000-0000-0000-0000-000000000000';
    for (const row of rows) {
      this.cursor = row.contract_id;
      try {
        await this.process(row.customer_id, row.contract_id);
      } catch {
        /* Durable decisions retry on the next tick. */
      }
    }
  }
}
