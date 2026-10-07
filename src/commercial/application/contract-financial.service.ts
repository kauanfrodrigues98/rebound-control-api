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
import {
  financialAccess,
  FINANCIAL_ACCESS_LABELS,
  FINANCIAL_SUSPEND_AFTER_DAYS,
} from '../domain/financial-access-policy';
import { env } from '../../config/env';
export const financialStateSchema = z
  .object({
    contractId: z.uuid(),
    customerId: z.uuid(),
    overdueSince: z.iso.datetime({ offset: true }).nullable(),
    paidThrough: z.iso.date().nullable(),
    paidInvoiceId: z.uuid().nullable(),
    paidTerms: contractSnapshotSchema.nullable(),
    accessTerms: contractSnapshotSchema.nullable().optional(),
    accessUntil: z.iso.datetime({ offset: true }).nullable().optional(),
    courtesy: z
      .object({
        active: z.boolean(),
        expiresAt: z.iso.datetime({ offset: true }).nullable(),
        reason: z.string(),
      })
      .strict()
      .nullable()
      .optional(),
    suspensionBillingPolicy: z.enum(['pause', 'continue']).optional(),
    renewalPaidOn: z.iso.date().nullable().optional(),
    recurrenceState: z
      .enum(['active', 'paused', 'renewal_required'])
      .optional(),
    renewalInvoiceId: z.uuid().nullable().optional(),
    nextCycleOn: z.iso.date().nullable().optional(),
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
    const [revision] = await this.source.query<Array<{ payload: unknown }>>(
      "SELECT payload FROM control.contract_commercial_revisions WHERE contract_id=$1 AND cancelled_at IS NULL AND (payload->>'effectiveAt')::timestamptz<=now() ORDER BY source_version DESC LIMIT 1",
      [contractId],
    );
    if (
      revision &&
      contractSnapshotSchema.parse(revision.payload).billingMode === 'courtesy'
    ) {
      const { financial } = await this.get(customerId, contractId);
      if (
        !financial.courtesy?.active ||
        !financial.accessTerms ||
        !financial.accessUntil
      )
        throw new ConflictException('Cortesia encerrada.');
      return {
        terms: financial.accessTerms,
        validUntil: financial.accessUntil,
      };
    }
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
    const state = await this.observe(customerId, contractId);
    const [decision] = await this.source.query<Decision[]>(
      `SELECT * FROM control.financial_decisions WHERE contract_id=$1 ORDER BY source_version DESC LIMIT 1`,
      [contractId],
    );
    return {
      financial: state,
      access: this.access(state),
      decision: decision
        ? {
            id: decision.id,
            sourceVersion: Number(decision.source_version),
            status: decision.status,
            state: decision.payload.state,
            accessState: decision.payload.accessState,
          }
        : null,
    };
  }
  private async observe(
    customerId: string,
    contractId: string,
    manager: Pick<DataSource, 'query'> = this.source,
  ) {
    const state = financialStateSchema.parse(
      await this.billing.request(
        `/commercial/contract-terms/${contractId}/financial-state`,
      ),
    );
    if (state.contractId !== contractId || state.customerId !== customerId)
      throw new ConflictException('Estado financeiro divergente.');
    const [enrollment] = await manager.query(
      'SELECT suspension_billing_policy FROM control.contract_billing_enrollments WHERE contract_id=$1',
      [contractId],
    );
    return {
      ...state,
      suspensionBillingPolicy: enrollment?.suspension_billing_policy ?? 'pause',
    } as z.infer<typeof financialStateSchema>;
  }
  private access(financial: z.infer<typeof financialStateSchema>) {
    if (financial.courtesy) {
      const state = financial.courtesy.active
        ? ('healthy' as const)
        : ('payment_suspended' as const);
      return {
        ...financialAccess(null, true),
        state,
        effectiveState: state,
        renewalRequired: false,
      };
    }
    const access = financialAccess(
      financial.overdueSince,
      env.FINANCIAL_SUSPENSION_ENABLED,
    );
    return {
      ...access,
      renewalRequired: financial.recurrenceState === 'renewal_required',
      effectiveState:
        financial.recurrenceState === 'renewal_required'
          ? ('payment_suspended' as const)
          : access.effectiveState,
    };
  }
  private core(financial: z.infer<typeof financialStateSchema>) {
    const access = this.access(financial);
    const grant = financial.accessTerms ?? financial.paidTerms;
    const validUntil =
      financial.accessUntil ??
      (financial.paidThrough
        ? new Date(`${financial.paidThrough}T00:00:00.000-03:00`).toISOString()
        : null);
    return {
      suspensionBillingPolicy: financial.suspensionBillingPolicy ?? 'pause',
      recurrenceState: financial.courtesy
        ? 'paused'
        : financial.suspensionBillingPolicy === 'continue'
          ? 'active'
          : access.renewalRequired
            ? 'renewal_required'
            : access.effectiveState === 'payment_suspended'
              ? 'paused'
              : 'active',
      customerId: financial.customerId,
      state:
        access.effectiveState === 'payment_suspended' ? 'suspended' : 'active',
      accessState: access.effectiveState,
      policyState: access.state,
      overdueSince: access.overdueSince,
      enforcementEnabled: access.enforcementEnabled,
      validUntil,
      graceDays: financial.courtesy ? 0 : FINANCIAL_SUSPEND_AFTER_DAYS,
      entitlements: grant
        ? {
            ...grant.entitlements,
            courtesy: !!financial.courtesy,
            commercialRevisionId: grant.sourceRevisionId,
            commercialVersion: grant.sourceVersion,
            financialManaged: true,
            financialAccessState: access.effectiveState,
            financialOverdueSince: access.overdueSince ?? '',
            financialRestrictAt: access.enforcementEnabled
              ? (access.restrictAt ?? '')
              : '',
            financialSuspendAt: access.enforcementEnabled
              ? (access.suspendAt ?? '')
              : '',
          }
        : {},
    };
  }
  private hash(payload: unknown) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }
  async process(customerId: string, contractId: string) {
    await this.source.transaction(async (tx) => {
      const [contract] = await tx.query<Array<{ status: string }>>(
        'SELECT status FROM control.customer_contracts WHERE id=$1 AND customer_id=$2 FOR UPDATE',
        [contractId, customerId],
      );
      if (!contract) throw new NotFoundException('Contrato não encontrado.');
      if (contract.status !== 'ativo') return;
      const financial = await this.observe(customerId, contractId, tx);
      const core = this.core(financial),
        hash = this.hash(core);
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
      // Persist access even before the first payment. Never invent paid license entitlements.
      const licenseDeliverable =
        !!(financial.accessTerms ?? financial.paidTerms) &&
        !!core.validUntil &&
        (core.state === 'suspended' ||
          core.accessState !== 'healthy' ||
          new Date(core.validUntil) > new Date());
      const decisionId = randomUUID();
      await tx.query(
        `INSERT INTO control.financial_decisions(id,contract_id,customer_id,source_version,payload,request_hash,status) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          decisionId,
          contractId,
          customerId,
          version,
          JSON.stringify({
            ...core,
            sourceVersion: version,
            licenseDeliverable,
          }),
          hash,
          'pending',
        ],
      );
      const changed = prior?.payload.accessState !== core.accessState;
      const recovered =
        core.accessState === 'healthy' &&
        !core.overdueSince &&
        prior &&
        prior.payload.accessState !== 'healthy';
      if (
        changed &&
        core.enforcementEnabled &&
        (core.accessState !== 'healthy' || recovered)
      ) {
        await tx.query(
          `INSERT INTO control.financial_notices(id,decision_id,contract_id,customer_id,access_state) VALUES($1,$2,$3,$4,$5)`,
          [randomUUID(), decisionId, contractId, customerId, core.accessState],
        );
      }
      if (prior && prior.payload.accessState !== core.accessState) {
        await tx.query(
          `INSERT INTO control.customer_timeline_entries(id,customer_id,type,title,description) VALUES($1,$2,'contrato','Estado financeiro atualizado',$3)`,
          [
            randomUUID(),
            customerId,
            `Contrato ${contractId}. Acesso: ${FINANCIAL_ACCESS_LABELS[core.accessState]}. Decisão ${version}.`,
          ],
        );
      }
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
      // Revalidate every pending state, including suspension: payment may have arrived meanwhile.
      const current = this.core(
        await this.observe(row.customer_id, contractId, tx),
      );
      if (this.hash(current) !== row.request_hash) {
        await tx.query(
          `UPDATE control.financial_decisions SET status='superseded' WHERE id=$1`,
          [row.id],
        );
        return;
      }
      try {
        const billingAck = await this.billing.request<{
          contractId: string;
          sourceVersion: number;
          nextCycleOn: string | null;
        }>('/commercial/recurrence/financial-state', {
          method: 'POST',
          actorId: '00000000-0000-4000-8000-000000000005',
          body: {
            contractId,
            customerId: row.customer_id,
            sourceVersion: Number(row.source_version),
            state: current.recurrenceState,
            suspensionBillingPolicy: current.suspensionBillingPolicy,
          },
        });
        if (
          billingAck.contractId !== contractId ||
          billingAck.sourceVersion !== Number(row.source_version)
        )
          throw new Error('Invalid recurrence acknowledgement');
        if (current.recurrenceState === 'active' && billingAck.nextCycleOn)
          await tx.query(
            'UPDATE control.contract_billing_enrollments SET next_cycle_on=$2 WHERE contract_id=$1',
            [contractId, billingAck.nextCycleOn],
          );
        if (!row.payload.licenseDeliverable) {
          await tx.query(
            "UPDATE control.financial_decisions SET status='observed',last_error=NULL WHERE id=$1",
            [row.id],
          );
          return;
        }
        const ack = await this.licensing.request<{
          contractId: string;
          sourceVersion: number;
        }>(`/admin/licenses/contracts/${contractId}/financial-state`, {
          method: 'POST',
          body: {
            customerId: row.customer_id,
            sourceVersion: Number(row.source_version),
            state: current.state,
            validUntil: current.validUntil,
            graceDays: current.graceDays,
            entitlements: current.entitlements,
          },
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
          `UPDATE control.financial_decisions SET attempts=attempts+1,last_error='financial_lifecycle_pending',next_attempt_at=now()+interval '5 minutes' WHERE id=$1`,
          [row.id],
        );
      }
    });
  }
  async suspensionPolicy(
    customerId: string,
    contractId: string,
    body: unknown,
    actorId: string,
  ) {
    const parsed = z
      .object({
        policy: z.enum(['pause', 'continue']),
        reason: z.string().trim().min(10).max(1000),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success)
      throw new ConflictException(
        'Informe a política e a referência do acordo.',
      );
    await this.source.transaction(async (tx) => {
      const [contract] = await tx.query(
        'SELECT status FROM control.customer_contracts WHERE id=$1 AND customer_id=$2 FOR UPDATE',
        [contractId, customerId],
      );
      if (!contract || contract.status !== 'ativo')
        throw new ConflictException('Contrato não está ativo.');
      const [customer] = await tx.query(
        'SELECT expected_environment FROM control.customers WHERE id=$1',
        [customerId],
      );
      const [cloud] = await tx.query(
        'SELECT account_uuid FROM control.cloud_billing_bindings WHERE contract_id=$1',
        [contractId],
      );
      if (
        parsed.data.policy === 'continue' &&
        (cloud ||
          !['self-hosted', 'hibrido'].includes(customer?.expected_environment))
      )
        throw new ConflictException(
          'Cobrança continuada é exclusiva de contratos self-hosted com acordo explícito.',
        );
      const [latest] = await tx.query(
        'SELECT payload FROM control.financial_decisions WHERE contract_id=$1 ORDER BY source_version DESC LIMIT 1',
        [contractId],
      );
      if (
        latest?.payload.recurrenceState &&
        latest.payload.recurrenceState !== 'active'
      )
        throw new ConflictException(
          'Regularize e retome o contrato antes de alterar esta política.',
        );
      const [[enrollment]] = await tx.query(
        'UPDATE control.contract_billing_enrollments SET suspension_billing_policy=$3 WHERE contract_id=$1 AND customer_id=$2 RETURNING id',
        [contractId, customerId, parsed.data.policy],
      );
      if (!enrollment)
        throw new ConflictException(
          'Ative a recorrência antes de configurar esta política.',
        );
      await tx.query(
        "INSERT INTO control.customer_timeline_entries(id,customer_id,type,title,description) VALUES($1,$2,'contrato','Política de cobrança durante suspensão alterada',$3)",
        [
          randomUUID(),
          customerId,
          `Contrato ${contractId}. Política: ${parsed.data.policy}. Operador: ${actorId}. Acordo: ${parsed.data.reason}`,
        ],
      );
    });
    return this.process(customerId, contractId);
  }
  async renew(
    customerId: string,
    contractId: string,
    body: unknown,
    actorId: string,
  ) {
    const parsed = z
      .object({ confirmedAmount: z.number().int().nonnegative() })
      .strict()
      .safeParse(body);
    if (!parsed.success || !z.uuid().safeParse(actorId).success)
      throw new ConflictException('Confirmação de retomada inválida.');
    await this.process(customerId, contractId);
    return this.source.transaction(async (tx) => {
      const [contract] = await tx.query(
        'SELECT status FROM control.customer_contracts WHERE id=$1 AND customer_id=$2 FOR UPDATE',
        [contractId, customerId],
      );
      if (!contract || contract.status !== 'ativo')
        throw new ConflictException('Contrato não está ativo.');
      const [termination] = await tx.query(
        'SELECT id FROM control.contract_terminations WHERE contract_id=$1',
        [contractId],
      );
      if (termination)
        throw new ConflictException('Contrato com encerramento solicitado.');
      const financial = await this.observe(customerId, contractId, tx);
      if (financial.courtesy)
        throw new ConflictException(
          'Cortesia não permite cobrança de retomada.',
        );
      if (
        financial.overdueSince ||
        financial.recurrenceState !== 'renewal_required'
      )
        throw new ConflictException(
          'Quite os débitos ou consulte o período pago antes de retomar.',
        );
      const [enrollment] = await tx.query(
        'SELECT e.*,e.first_cycle_on::text AS first_cycle_on,e.next_cycle_on::text AS next_cycle_on FROM control.contract_billing_enrollments e WHERE contract_id=$1 FOR UPDATE',
        [contractId],
      );
      if (!enrollment?.enabled)
        throw new ConflictException(
          'Recorrência pausada manualmente; fale com o financeiro.',
        );
      const [revision] = await tx.query(
        "SELECT id,status,payload FROM control.contract_commercial_revisions WHERE contract_id=$1 AND cancelled_at IS NULL AND (payload->>'effectiveAt')::timestamptz<=now() ORDER BY source_version DESC LIMIT 1",
        [contractId],
      );
      if (
        !revision ||
        revision.status !== 'synced' ||
        revision.payload.amount !== parsed.data.confirmedAmount
      )
        throw new ConflictException('Confira novamente o valor vigente.');
      const ack = await this.billing.request<{
        invoiceId: string;
        nextCycleOn: string | null;
        scheduleId: string;
      }>('/commercial/recurrence/advance', {
        method: 'POST',
        actorId,
        body: {
          customerId,
          contractId,
          enrollmentId: enrollment.id,
          initialRevisionId: enrollment.initial_revision_id,
          currentRevisionId: revision.id,
          periodRevisionId: revision.id,
          firstCycleOn: enrollment.first_cycle_on,
          expectedCycleOn:
            enrollment.next_cycle_on ?? enrollment.first_cycle_on,
          enrolledAt: enrollment.created_at.toISOString(),
          renewal: parsed.data,
        },
      });
      if (ack.scheduleId !== enrollment.billing_schedule_id)
        throw new ConflictException('Recorrência divergente.');
      await tx.query(
        'UPDATE control.contract_billing_enrollments SET next_cycle_on=$2,last_invoice_id=$3 WHERE id=$1',
        [enrollment.id, ack.nextCycleOn, ack.invoiceId],
      );
      await tx.query(
        "INSERT INTO control.customer_timeline_entries(id,customer_id,type,title,description) VALUES($1,$2,'contrato','Retomada solicitada',$3)",
        [
          randomUUID(),
          customerId,
          `Fatura ${ack.invoiceId}. Novo ciclo sem cobrança retroativa; acesso após pagamento.`,
        ],
      );
      return ack;
    });
  }
  async run() {
    const rows = await this.source.query<
      Array<{ customer_id: string; contract_id: string }>
    >(
      `SELECT c.customer_id,c.id AS contract_id FROM control.customer_contracts c JOIN LATERAL (SELECT payload FROM control.contract_commercial_revisions r WHERE r.contract_id=c.id AND r.cancelled_at IS NULL AND (r.payload->>'effectiveAt')::timestamptz<=now() ORDER BY source_version DESC LIMIT 1) r ON true LEFT JOIN control.contract_billing_enrollments e ON e.contract_id=c.id WHERE c.status='ativo' AND (e.id IS NOT NULL OR r.payload->>'billingMode'='courtesy') AND c.id>$1 ORDER BY c.id LIMIT 25`,
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
