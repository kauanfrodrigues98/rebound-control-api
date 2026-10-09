import { signReceipt, receiptSecret, archiveReceipt } from './erasure-receipt';
import { ContractTerminationService } from '../commercial/application/contract-termination.service';
import { CloudPlanChangeService } from './cloud-plan-change.service';
import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env';
import { BillingAdminClient } from '../billing/billing-admin.client';
import { LicensingAdminClient } from '../infra/licensing/licensing-admin.client';
import { ContractCommercialService } from '../commercial/application/contract-commercial.service';
import { ContractRecurrenceService } from '../commercial/application/contract-recurrence.service';
import { ContractFinancialService } from '../commercial/application/contract-financial.service';
export interface Plan {
  id: string;
  name: string;
  active: boolean;
  cadence: string;
  deployment: 'cloud' | 'self_hosted';
  entitlements: Record<string, string | number | boolean>;
}
export interface Price {
  id: string;
  amount: number;
  currency: 'BRL' | 'USD';
  intervalMonths: 1 | 3 | 6 | 12;
}
interface Binding {
  account_uuid: string;
  customer_id: string;
  contract_id: string;
  onboarding: {
    name: string;
    email: string;
    startsOn: string;
    effectiveAt: string;
    planId: string;
    priceId: string;
    currency?: 'BRL' | 'USD';
    dueDay: number;
  };
}
const actor = '00000000-0000-4000-8000-000000000005';
@Injectable()
export class CloudBillingService {
  constructor(
    private readonly source: DataSource,
    private readonly billing: BillingAdminClient,
    private readonly licensing: LicensingAdminClient,
    private readonly commercial: ContractCommercialService,
    private readonly recurrence: ContractRecurrenceService,
    private readonly financial: ContractFinancialService,
    private readonly changes: CloudPlanChangeService,
    private readonly terminations: ContractTerminationService,
  ) {}
  async terminate(accountUuid: string, body: unknown, key: string) {
    const row = await this.binding(accountUuid);
    return this.terminations.request(
      row.customer_id,
      row.contract_id,
      body,
      actor,
      key,
    );
  }
  async erasureLedger(after?: string) {
    receiptSecret();
    if (after && !z.string().uuid().safeParse(after).success)
      throw new BadRequestException('Cursor inválido.');
    const rows = await this.source.query<
      Array<{
        id: string;
        account_uuid: string;
        effective_at: Date;
        operational_retention_until: Date;
        operational_erased_at: Date;
      }>
    >(
      `SELECT b.account_uuid,t.id,t.effective_at,t.operational_retention_until,t.operational_erased_at
      FROM control.contract_terminations t JOIN control.cloud_billing_bindings b ON b.contract_id=t.contract_id
      WHERE t.operational_erased_at IS NOT NULL AND ($1::uuid IS NULL OR b.account_uuid>$1::uuid)
      ORDER BY b.account_uuid LIMIT 250`,
      [after ?? null],
    );
    const records = rows.map(
      (r: {
        account_uuid: string;
        id: string;
        effective_at: Date;
        operational_retention_until: Date;
        operational_erased_at: Date;
      }) =>
        signReceipt({
          version: 1,
          accountUuid: r.account_uuid,
          terminationId: r.id,
          effectiveAt: r.effective_at.toISOString(),
          preserveUntil: r.operational_retention_until.toISOString(),
          erasedAt: r.operational_erased_at.toISOString(),
        }),
    );
    return {
      records,
      nextCursor:
        rows.length === 250 ? rows[rows.length - 1].account_uuid : null,
    };
  }
  async confirmDataErasure(accountUuid: string, body: unknown) {
    const parsed = z
      .object({ terminationId: z.string().uuid() })
      .strict()
      .safeParse(body);
    if (!parsed.success) throw new BadRequestException('Confirmação inválida.');
    const binding = await this.binding(accountUuid);
    const rows = await this.source.query<
      Array<{
        id: string;
        effective_at: Date;
        operational_retention_until: Date;
        operational_erased_at: Date;
      }>
    >(
      `WITH confirmed AS (UPDATE control.contract_terminations SET operational_erased_at=coalesce(operational_erased_at,now())
      WHERE contract_id=$1 AND id=$2 AND status='completed' AND billing_synced_at IS NOT NULL
      AND licensing_synced_at IS NOT NULL AND operational_retention_days=30
      AND operational_retention_until>=effective_at+interval '30 days'
      AND operational_retention_until<=now() RETURNING id,effective_at,operational_retention_until,operational_erased_at) SELECT * FROM confirmed`,
      [binding.contract_id, parsed.data.terminationId],
    );
    if (!rows.length)
      throw new ConflictException('Encerramento não elegível para exclusão.');
    const row = rows[0];
    await archiveReceipt(
      signReceipt({
        version: 1,
        accountUuid,
        terminationId: row.id,
        effectiveAt: row.effective_at.toISOString(),
        preserveUntil: row.operational_retention_until.toISOString(),
        erasedAt: row.operational_erased_at.toISOString(),
      }),
    );
    return { confirmed: true };
  }
  async plans(currency: 'BRL' | 'USD' = 'BRL') {
    const catalog = await this.licensing.request<{ plans: Plan[] }>(
      '/admin/licenses/plans',
    );
    const result: Array<Plan & { price: Price }> = [];
    for (const plan of catalog.plans) {
      if (!plan.active || plan.deployment !== 'cloud') continue;
      const prices = await this.billing.request<{ current: Price | null }>(
        `/commercial/plans/${encodeURIComponent(plan.id)}/prices?currency=${currency}`,
      );
      if (prices.current) result.push({ ...plan, price: prices.current });
    }
    return { plans: result };
  }
  async binding(accountUuid: string) {
    const [row] = await this.source.query<Binding[]>(
      'SELECT * FROM control.cloud_billing_bindings WHERE account_uuid=$1',
      [accountUuid],
    );
    if (!row) throw new NotFoundException('Conta cloud ainda não vinculada.');
    return row;
  }
  async provision(accountUuid: string, body: unknown) {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(180),
        email: z.email().max(320),
        currency: z.enum(['BRL', 'USD']).default('BRL'),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('Cadastro cloud inválido.');
    let binding: Binding | undefined;
    const [existing] = await this.source.query<Binding[]>(
      'SELECT * FROM control.cloud_billing_bindings WHERE account_uuid=$1',
      [accountUuid],
    );
    if (existing) binding = existing;
    else {
      const plans = await this.plans(parsed.data.currency),
        free = plans.plans.find(
          (v) => v.id === env.CLOUD_DEFAULT_PLAN_ID && v.price.amount === 0,
        );
      if (!free)
        throw new ConflictException(
          'Configure um plano inicial gratuito no catálogo interno.',
        );
      binding = await this.source.transaction(async (tx) => {
        await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
          accountUuid,
        ]);
        const [prior] = await tx.query<Binding[]>(
          'SELECT * FROM control.cloud_billing_bindings WHERE account_uuid=$1',
          [accountUuid],
        );
        if (prior) return prior;
        const [clock] = await tx.query<Array<{ day: string; now: Date }>>(
          `SELECT (now() AT TIME ZONE 'America/Recife')::date::text AS day,now() AS now`,
        );
        const customerId = randomUUID(),
          contractId = randomUUID(),
          onboarding = {
            ...parsed.data,
            startsOn: clock.day,
            effectiveAt: clock.now.toISOString(),
            planId: free.id,
            priceId: free.price.id,
            dueDay: Number(clock.day.slice(-2)),
          };
        await tx.query(
          `INSERT INTO control.customers(id,name,type,stage,expected_environment) VALUES($1,$2,'cliente','operacao','cloud')`,
          [customerId, parsed.data.name],
        );
        await tx.query(
          `INSERT INTO control.customer_contracts(id,customer_id,code,plan,plan_id,status,cycle,starts_on,due_day,payment_method) VALUES($1,$2,$3,$4,$5,'ativo','mensal',$6,$7,$8)`,
          [
            contractId,
            customerId,
            `CLD-${accountUuid.slice(0, 24)}`,
            free.name,
            free.id,
            clock.day,
            String(onboarding.dueDay),
            onboarding.currency === 'USD' ? 'Cartão' : 'Cartão ou boleto',
          ],
        );
        return (
          await tx.query<Binding[]>(
            `INSERT INTO control.cloud_billing_bindings(account_uuid,customer_id,contract_id,onboarding) VALUES($1,$2,$3,$4) RETURNING *`,
            [accountUuid, customerId, contractId, JSON.stringify(onboarding)],
          )
        )[0];
      });
    }
    const row = binding,
      initial = row.onboarding;
    const versions = await this.commercial.list(
      row.customer_id,
      row.contract_id,
    );
    if (versions.versions.length === 0)
      await this.commercial.publish(
        row.customer_id,
        row.contract_id,
        {
          planId: initial.planId,
          currency: initial.currency ?? 'BRL',
          pricing: 'catalog',
          priceVersionId: initial.priceId,
          setupAmount: 0,
          dueDay: initial.dueDay,
          allowedMethods:
            initial.currency === 'USD' ? ['card'] : ['card', 'boleto'],
          startsOn: initial.startsOn,
          endsOn: null,
          effectiveAt:
            Date.now() - new Date(initial.effectiveAt).getTime() < 55000
              ? initial.effectiveAt
              : new Date().toISOString(),
          overrides: {},
          reason: 'Cadastro cloud com autoatendimento',
        },
        actor,
        `cloud-onboarding:${accountUuid}`,
      );
    const refreshed = await this.commercial.list(
      row.customer_id,
      row.contract_id,
    );
    const first = refreshed.versions.find((v) => v.sourceVersion === 1);
    if (first?.status === 'pending')
      await this.commercial.sync(row.customer_id, row.contract_id, first.id);
    const current = await this.commercial.list(
      row.customer_id,
      row.contract_id,
    );
    if (current.current?.status !== 'synced')
      throw new ConflictException(
        'Cadastro salvo; sincronização comercial pendente.',
      );
    // Preserve existing profile on retries; never overwrite an operator's settings.
    const overview = await this.billing.request<{ profile: unknown }>(
      `/financial/customers/${row.customer_id}`,
    );
    if (!overview.profile)
      await this.billing.request(
        `/financial/customers/${row.customer_id}/profile`,
        {
          method: 'PUT',
          actorId: actor,
          body: {
            name: initial.name,
            email: initial.email,
            document: '',
            allowedMethods:
              initial.currency === 'USD' ? ['card'] : ['card', 'boleto'],
            externalInstructions: '',
            notificationsEnabled: false,
          },
        },
      );
    let enrollment = await this.recurrence.get(
      row.customer_id,
      row.contract_id,
    );
    if (!enrollment) {
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Recife',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      enrollment = await this.recurrence.enroll(
        row.customer_id,
        row.contract_id,
        {
          firstCycleOn: today,
          reason: 'Cadastro cloud novo; sem cobrança anterior',
          legacyCollectionStopped: true,
        },
        actor,
        `cloud-recurrence:${accountUuid}`,
      );
    }
    await this.recurrence.process(row.customer_id, row.contract_id);
    return this.state(accountUuid);
  }
  async renew(accountUuid: string, body: unknown) {
    const row = await this.binding(accountUuid);
    return this.financial.renew(row.customer_id, row.contract_id, body, actor);
  }
  async usage(accountUuid: string, body: unknown) {
    const row = await this.binding(accountUuid);
    const parsed = z
      .object({
        entries: z
          .array(
            z
              .object({
                id: z.uuid(),
                sourceRevisionId: z.uuid(),
                resource: z.enum([
                  'dlq_events',
                  'ai_analysis',
                  'payload_replays',
                ]),
                quantity: z.number().int().positive().max(1000000),
                unitPriceCents: z.number().int().positive().max(100000000),
                occurredAt: z.iso.datetime({ offset: true }),
              })
              .strict(),
          )
          .min(1)
          .max(100),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success) throw new BadRequestException('Consumo inválido.');
    return this.billing.request<{ acceptedIds: string[] }>(
      `/commercial/contract-terms/${row.contract_id}/usage`,
      {
        method: 'POST',
        actorId: actor,
        body: { customerId: row.customer_id, ...parsed.data },
      },
    );
  }
  async state(accountUuid: string) {
    await this.changes.processAccount(accountUuid);
    const row = await this.binding(accountUuid);
    const financial = await this.financial.process(
      row.customer_id,
      row.contract_id,
    );
    const [commercial, recurrence] = await Promise.all([
      this.commercial.list(row.customer_id, row.contract_id),
      this.recurrence.get(row.customer_id, row.contract_id),
    ]);
    return {
      customerId: row.customer_id,
      contractId: row.contract_id,
      current: commercial.current,
      recurrence,
      financial: financial.financial,
      access: financial.access,
      planChange: await this.changes.latest(accountUuid),
      termination: await this.terminations.get(
        row.customer_id,
        row.contract_id,
      ),
    };
  }
  async portal(accountUuid: string) {
    const row = await this.binding(accountUuid);
    return this.billing.request(
      `/financial/customers/${row.customer_id}/access`,
      { method: 'POST', actorId: actor, body: { expiresInHours: 24 } },
    );
  }
  async previewChange(accountUuid: string, body: unknown) {
    const parsed = z
      .object({
        planId: z
          .string()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .max(80),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success) throw new BadRequestException('Plano inválido.');
    const row = await this.binding(accountUuid);
    const { current } = await this.commercial.list(
      row.customer_id,
      row.contract_id,
    );
    const catalog = await this.plans(
      current?.terms.currency ?? row.onboarding.currency ?? 'BRL',
    );
    const plan = catalog.plans.find((value) => value.id === parsed.data.planId);
    if (!plan)
      throw new BadRequestException(
        'Plano não disponível para contratação Cloud.',
      );
    return (await this.changes.preview(row, plan)).quote;
  }
  async cancelChange(accountUuid: string, id: string) {
    await this.binding(accountUuid);
    return this.changes.cancel(accountUuid, id);
  }
  async change(accountUuid: string, body: unknown, key: string) {
    const parsed = z
      .object({
        planId: z
          .string()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .max(80),
        expectedAmount: z.number().int().nonnegative().optional(),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success || !/^[A-Za-z0-9._:-]{1,80}$/.test(key ?? ''))
      throw new BadRequestException('Plano ou chave inválida.');
    const row = await this.binding(accountUuid);
    const replay = await this.changes.replay(
      accountUuid,
      key,
      parsed.data.planId,
      parsed.data.expectedAmount,
    );
    if (replay) return replay;
    const { current } = await this.commercial.list(
      row.customer_id,
      row.contract_id,
    );
    const catalog = await this.plans(
      current?.terms.currency ?? row.onboarding.currency ?? 'BRL',
    );
    const plan = catalog.plans.find((value) => value.id === parsed.data.planId);
    if (!plan)
      throw new BadRequestException(
        'Plano não disponível para contratação Cloud.',
      );
    return this.changes.start(row, plan, key, parsed.data.expectedAmount);
  }
}
