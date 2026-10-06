import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { BillingAdminClient } from '../billing/billing-admin.client';
import { ContractCommercialService } from '../commercial/application/contract-commercial.service';
import { ContractFinancialService } from '../commercial/application/contract-financial.service';
import { ContractRecurrenceService } from '../commercial/application/contract-recurrence.service';
import { ContractCancellationService } from '../commercial/application/contract-cancellation.service';
import type { ContractSnapshot } from '../commercial/domain/contract-terms';
import type { Plan, Price } from './cloud-billing.service';
const actor = '00000000-0000-4000-8000-000000000005';
type Target = Omit<ContractSnapshot, 'sourceRevisionId' | 'sourceVersion'>;
interface Binding {
  account_uuid: string;
  customer_id: string;
  contract_id: string;
}
export interface Quote {
  kind: 'free_upgrade' | 'upgrade' | 'downgrade';
  amount: number;
  credit: number;
  debit: number;
  startsOn: string;
  endsOn: string;
  remainingDays: number;
  totalDays: number;
  baseRevisionId: string;
  baseInvoiceId: string;
  targetAmount: number;
  targetIntervalMonths: number;
}
interface Change {
  id: string;
  account_uuid: string;
  customer_id: string;
  contract_id: string;
  request_hash: string;
  plan_id: string;
  target: Target;
  quote: Quote;
  kind: Quote['kind'];
  status: string;
  revision_id: string | null;
  invoice_id: string | null;
  last_error: string | null;
}
interface PaymentState {
  status: string;
  invoiceId: string;
  paidAt: string | null;
  quote: Quote;
  target: Target;
  periodEndOn: string | null;
}
@Injectable()
export class CloudPlanChangeService {
  constructor(
    private readonly source: DataSource,
    private readonly billing: BillingAdminClient,
    private readonly commercial: ContractCommercialService,
    private readonly recurrence: ContractRecurrenceService,
    private readonly financial: ContractFinancialService,
    private readonly cancellations: ContractCancellationService,
  ) {}
  private response(row: Change | null) {
    return row
      ? {
          id: row.id,
          planId: row.plan_id,
          kind: row.kind,
          status: row.status,
          invoiceId: row.invoice_id,
          quote: row.quote,
          effectiveOn: row.kind === 'downgrade' ? row.quote.endsOn : null,
          lastError: row.last_error,
        }
      : null;
  }
  async latest(account: string) {
    const [row] = await this.source.query<Change[]>(
      'SELECT * FROM control.cloud_plan_change_requests WHERE account_uuid=$1 ORDER BY created_at DESC,id DESC LIMIT 1',
      [account],
    );
    return this.response(row ?? null);
  }
  async replay(
    account: string,
    key: string,
    planId: string,
    expectedAmount: number | undefined,
  ) {
    const [row] = await this.source.query<Change[]>(
      'SELECT * FROM control.cloud_plan_change_requests WHERE account_uuid=$1 AND request_key=$2',
      [account, key],
    );
    if (!row) return null;
    const hash = createHash('sha256')
      .update(JSON.stringify({ planId, expectedAmount }))
      .digest('hex');
    if (row.request_hash !== hash)
      throw new ConflictException('Chave já usada para outra alteração.');
    await this.process(row.id);
    return this.get(row.id);
  }
  private async get(id: string) {
    const [row] = await this.source.query<Change[]>(
      'SELECT * FROM control.cloud_plan_change_requests WHERE id=$1',
      [id],
    );
    return this.response(row ?? null);
  }
  async preview(binding: Binding, plan: Plan & { price: Price }) {
    const { current } = await this.commercial.list(
      binding.customer_id,
      binding.contract_id,
    );
    const recurrence = await this.recurrence.get(
      binding.customer_id,
      binding.contract_id,
    );
    if (
      !current ||
      current.status !== 'synced' ||
      !recurrence?.enabled ||
      !recurrence.nextCycleOn
    )
      throw new ConflictException('Recorrência ou condições pendentes.');
    const base = current.terms;
    const target: Target = {
      customerId: binding.customer_id,
      contractId: binding.contract_id,
      planId: plan.id,
      pricing: 'catalog',
      priceVersionId: plan.price.id,
      amount: plan.price.amount,
      currency: 'BRL',
      intervalMonths: plan.price.intervalMonths,
      setupAmount: 0,
      dueDay: base.dueDay,
      allowedMethods: base.allowedMethods,
      startsOn: base.startsOn,
      endsOn: base.endsOn,
      effectiveAt: new Date().toISOString(),
      reason: 'Mudança solicitada pelo cliente no painel Cloud',
      entitlements: {
        ...plan.entitlements,
        planId: plan.id,
        planName: plan.name,
        cadence: plan.cadence,
      },
    };
    const quote = await this.billing.request<Quote>(
      '/commercial/plan-changes/preview',
      { method: 'POST', body: { target }, actorId: actor },
    );
    return { target, quote };
  }
  async start(
    binding: Binding,
    plan: Plan & { price: Price },
    key: string,
    expectedAmount: number | undefined,
  ) {
    const replay = await this.replay(
      binding.account_uuid,
      key,
      plan.id,
      expectedAmount,
    );
    if (replay) return replay;
    const { target, quote } = await this.preview(binding, plan);
    if (expectedAmount !== quote.amount)
      throw new ConflictException(
        'Confira o valor atualizado antes de confirmar.',
      );
    if (quote.kind === 'downgrade')
      target.effectiveAt = `${quote.endsOn}T00:00:00.000-03:00`;
    const hash = createHash('sha256')
      .update(JSON.stringify({ planId: plan.id, expectedAmount }))
      .digest('hex');
    const row = await this.source.transaction(async (tx) => {
      const [contract] = await tx.query<Array<{ status: string }>>(
        'SELECT status FROM control.customer_contracts WHERE id=$1 AND customer_id=$2 FOR UPDATE',
        [binding.contract_id, binding.customer_id],
      );
      const [termination] = await tx.query(
        'SELECT id FROM control.contract_terminations WHERE contract_id=$1',
        [binding.contract_id],
      );
      if (termination)
        throw new ConflictException('Contrato com encerramento solicitado.');
      if (contract?.status !== 'ativo')
        throw new ConflictException('Contrato não está ativo.');
      const [prior] = await tx.query<Change[]>(
        'SELECT * FROM control.cloud_plan_change_requests WHERE account_uuid=$1 AND request_key=$2',
        [binding.account_uuid, key],
      );
      if (prior) {
        if (prior.request_hash !== hash)
          throw new ConflictException('Chave já utilizada.');
        return prior;
      }
      const [pending] = await tx.query<Change[]>(
        "SELECT * FROM control.cloud_plan_change_requests WHERE contract_id=$1 AND status IN ('requested','awaiting_payment','scheduled','activated')",
        [binding.contract_id],
      );
      if (pending)
        throw new ConflictException(
          'Já existe uma alteração pendente; conclua ou cancele antes de mudar novamente.',
        );
      const [future] = await tx.query<Array<{ id: string }>>(
        "SELECT id FROM control.contract_commercial_revisions WHERE contract_id=$1 AND cancelled_at IS NULL AND (payload->>'effectiveAt')::timestamptz>now() LIMIT 1",
        [binding.contract_id],
      );
      if (future)
        throw new ConflictException(
          'Há condições futuras no Control; revise antes de mudar pelo Cloud.',
        );
      const [created] = await tx.query<Change[]>(
        `INSERT INTO control.cloud_plan_change_requests(id,account_uuid,customer_id,contract_id,request_key,request_hash,plan_id,target,quote,kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          randomUUID(),
          binding.account_uuid,
          binding.customer_id,
          binding.contract_id,
          key,
          hash,
          plan.id,
          JSON.stringify(target),
          JSON.stringify(quote),
          quote.kind,
        ],
      );
      await tx.query(
        "INSERT INTO control.customer_timeline_entries(customer_id,type,title,description) VALUES($1,'observacao','Alteração de plano Cloud solicitada',$2)",
        [
          binding.customer_id,
          `${plan.name} · ${quote.kind === 'downgrade' ? 'Downgrade no fim do ciclo' : 'Upgrade após quitação'} · Solicitação ${created.id}`,
        ],
      );
      return created;
    });
    await this.process(row.id);
    return this.get(row.id);
  }
  async cancel(account: string, id: string) {
    const [row] = await this.source.query<Change[]>(
      'SELECT * FROM control.cloud_plan_change_requests WHERE id=$1 AND account_uuid=$2',
      [id, account],
    );
    if (!row) throw new NotFoundException('Alteração não encontrada.');
    if (row.status === 'cancelled') return this.response(row);
    if (!['scheduled', 'awaiting_payment', 'needs_review'].includes(row.status))
      throw new ConflictException(
        'Alteração não pode ser cancelada neste estado.',
      );
    const [[claimed]] = await this.source.query<[Change[], number]>(
      "UPDATE control.cloud_plan_change_requests SET lease_until=now()+interval '5 minutes' WHERE id=$1 AND status IN ('scheduled','awaiting_payment','needs_review') AND (lease_until IS NULL OR lease_until<now()) RETURNING *",
      [id],
    );
    if (!claimed)
      throw new ConflictException(
        'Alteração em processamento; tente novamente.',
      );
    try {
      if (row.kind === 'downgrade') {
        if (!row.revision_id) throw new ConflictException('Revisão pendente.');
        await this.cancellations.cancel(
          row.customer_id,
          row.contract_id,
          row.revision_id,
          { reason: 'Cliente cancelou o downgrade agendado no painel Cloud' },
          actor,
        );
      } else
        await this.billing.request(
          `/commercial/plan-changes/${row.id}/cancel`,
          { method: 'POST', actorId: actor, key: row.id },
        );
      await this.source.query(
        "UPDATE control.cloud_plan_change_requests SET status='cancelled',updated_at=now(),last_error=NULL WHERE id=$1",
        [id],
      );
    } finally {
      await this.source.query(
        'UPDATE control.cloud_plan_change_requests SET lease_until=NULL WHERE id=$1',
        [id],
      );
    }

    return this.get(id);
  }
  async processAccount(account: string) {
    const [row] = await this.source.query<Change[]>(
      "SELECT * FROM control.cloud_plan_change_requests WHERE account_uuid=$1 AND status IN ('requested','awaiting_payment','scheduled','activated') ORDER BY created_at DESC LIMIT 1",
      [account],
    );
    if (row) await this.process(row.id);
  }
  async process(id: string) {
    const [[row]] = await this.source.query<[Change[], number]>(
      "UPDATE control.cloud_plan_change_requests SET lease_until=now()+interval '5 minutes' WHERE id=$1 AND status IN ('requested','awaiting_payment','scheduled','activated') AND (lease_until IS NULL OR lease_until<now()) RETURNING *",
      [id],
    );
    if (!row) return;
    const [termination] = await this.source.query(
      'SELECT id FROM control.contract_terminations WHERE contract_id=$1',
      [row.contract_id],
    );
    if (termination) {
      await this.source.query(
        "UPDATE control.cloud_plan_change_requests SET status='needs_review',last_error='contract_termination',lease_until=NULL WHERE id=$1",
        [id],
      );
      return;
    }
    try {
      if (row.kind === 'downgrade') {
        const revision = await this.commercial.publishConfirmedSnapshot(
          row.customer_id,
          row.contract_id,
          row.target,
          actor,
          `cloud-change:${row.id}`,
        );
        if (revision.status !== 'synced') throw new Error('commercial_pending');
        await this.source.query(
          "UPDATE control.cloud_plan_change_requests SET status='scheduled',revision_id=$2,last_error=NULL WHERE id=$1",
          [row.id, revision.id],
        );
        if (new Date(row.target.effectiveAt) <= new Date()) {
          await this.recurrence.process(row.customer_id, row.contract_id);
          const period = await this.recurrence.get(
            row.customer_id,
            row.contract_id,
          );
          if (period?.nextCycleOn && period.nextCycleOn > row.quote.endsOn) {
            await this.financial.process(row.customer_id, row.contract_id);
            await this.source.query(
              "UPDATE control.cloud_plan_change_requests SET status='completed',updated_at=now() WHERE id=$1",
              [row.id],
            );
          }
        }
        return;
      }
      let payment: PaymentState;
      if (row.status === 'requested') {
        payment = await this.billing.request<PaymentState>(
          '/commercial/plan-changes',
          {
            method: 'POST',
            body: {
              id: row.id,
              target: row.target,
              expectedAmount: row.quote.amount,
            },
            actorId: actor,
            key: row.id,
          },
        );
        await this.source.query(
          "UPDATE control.cloud_plan_change_requests SET status='awaiting_payment',invoice_id=$2,last_error=NULL WHERE id=$1",
          [row.id, payment.invoiceId],
        );
      } else
        payment = await this.billing.request<PaymentState>(
          `/commercial/plan-changes/${row.id}`,
        );
      if (payment.status === 'awaiting_payment') return;
      if (['needs_review', 'expired', 'cancelled'].includes(payment.status)) {
        await this.source.query(
          'UPDATE control.cloud_plan_change_requests SET status=$2,last_error=$3,updated_at=now() WHERE id=$1',
          [
            row.id,
            payment.status === 'cancelled' ? 'cancelled' : 'needs_review',
            payment.status,
          ],
        );
        return;
      }
      if (!['paid', 'activated'].includes(payment.status)) return;
      const key = `cloud-change:${row.id}`;
      const [existing] = await this.source.query<
        Array<{ id: string; payload: ContractSnapshot }>
      >(
        'SELECT id,payload FROM control.contract_commercial_revisions WHERE contract_id=$1 AND request_key=$2',
        [row.contract_id, key],
      );
      if (!existing) {
        const { current } = await this.commercial.list(
          row.customer_id,
          row.contract_id,
        );
        if (current?.id !== row.quote.baseRevisionId)
          throw new ConflictException(
            'Condições do contrato mudaram; revisão manual necessária.',
          );
      }
      const target = existing
        ? {
            ...row.target,
            effectiveAt: existing.payload.effectiveAt,
            dueDay: existing.payload.dueDay,
          }
        : {
            ...row.target,
            effectiveAt: new Date(
              Math.max(
                new Date(payment.paidAt!).getTime(),
                new Date(row.target.effectiveAt).getTime(),
              ),
            ).toISOString(),
            dueDay:
              row.kind === 'free_upgrade'
                ? Number(
                    new Intl.DateTimeFormat('en-CA', {
                      timeZone: 'America/Recife',
                      day: '2-digit',
                    }).format(
                      new Date(
                        Math.max(
                          new Date(payment.paidAt!).getTime(),
                          new Date(row.target.effectiveAt).getTime(),
                        ),
                      ),
                    ),
                  )
                : row.target.dueDay,
          };
      const revision = await this.commercial.publishConfirmedSnapshot(
        row.customer_id,
        row.contract_id,
        target,
        actor,
        key,
      );
      if (revision.status !== 'synced') throw new Error('commercial_pending');
      const ack = await this.billing.request<{
        nextCycleOn: string;
        activated: boolean;
      }>(`/commercial/plan-changes/${row.id}/activate`, {
        method: 'POST',
        body: { revisionId: revision.id },
        actorId: actor,
        key: row.id,
      });
      await this.source.transaction(async (tx) => {
        await tx.query(
          'SELECT id FROM control.customer_contracts WHERE id=$1 FOR UPDATE',
          [row.contract_id],
        );
        if (row.kind === 'free_upgrade')
          await tx.query(
            'UPDATE control.contract_billing_enrollments SET next_cycle_on=$2,next_attempt_at=now(),last_error=NULL WHERE contract_id=$1',
            [row.contract_id, ack.nextCycleOn],
          );
        await tx.query(
          "UPDATE control.cloud_plan_change_requests SET status='activated',revision_id=$2,last_error=NULL,updated_at=now() WHERE id=$1",
          [row.id, revision.id],
        );
      });
      const financial = await this.financial.process(
        row.customer_id,
        row.contract_id,
      );
      if (financial?.decision?.status !== 'synced')
        throw new Error('licensing_pending');
      await this.source.transaction(async (tx) => {
        const [[done]] = await tx.query<[Change[], number]>(
          "UPDATE control.cloud_plan_change_requests SET status='completed',updated_at=now() WHERE id=$1 AND status='activated' RETURNING *",
          [row.id],
        );
        if (done)
          await tx.query(
            "INSERT INTO control.customer_timeline_entries(customer_id,type,title,description) VALUES($1,'observacao','Upgrade Cloud quitado e ativado',$2)",
            [
              row.customer_id,
              `${row.target.entitlements.planName} · Fatura ${payment.invoiceId} · Solicitação ${row.id}`,
            ],
          );
      });
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 409) {
        await this.source.query(
          "UPDATE control.cloud_plan_change_requests SET status='needs_review',last_error='conditions_conflict',updated_at=now() WHERE id=$1 AND status IN ('requested','awaiting_payment','scheduled','activated')",
          [row.id],
        );
        return;
      }
      await this.source.query(
        "UPDATE control.cloud_plan_change_requests SET last_error='integration_pending',next_attempt_at=now()+interval '15 seconds' WHERE id=$1",
        [row.id],
      );
    } finally {
      await this.source.query(
        "UPDATE control.cloud_plan_change_requests SET lease_until=NULL,next_attempt_at=GREATEST(next_attempt_at,now()+interval '5 seconds') WHERE id=$1",
        [row.id],
      );
    }
  }
  async run() {
    const rows = await this.source.query<Array<{ id: string }>>(
      "SELECT id FROM control.cloud_plan_change_requests WHERE status IN ('requested','awaiting_payment','scheduled','activated') AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_attempt_at LIMIT 10",
    );
    for (const row of rows) await this.process(row.id);
  }
}
