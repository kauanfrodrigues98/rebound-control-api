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
  entitlements: Record<string, string | number | boolean>;
}
export interface Price {
  id: string;
  amount: number;
  currency: 'BRL';
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
  ) {}
  async plans() {
    const allowed = env.CLOUD_SELF_SERVICE_PLAN_IDS.split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    const catalog = await this.licensing.request<{ plans: Plan[] }>(
      '/admin/licenses/plans',
    );
    const result: Array<Plan & { price: Price }> = [];
    for (const plan of catalog.plans) {
      if (!plan.active || !allowed.includes(plan.id)) continue;
      const prices = await this.billing.request<{ current: Price | null }>(
        `/commercial/plans/${encodeURIComponent(plan.id)}/prices`,
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
      const plans = await this.plans(),
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
          `INSERT INTO control.customer_contracts(id,customer_id,code,plan,plan_id,status,cycle,starts_on,due_day,payment_method) VALUES($1,$2,$3,$4,$5,'ativo','mensal',$6,$7,'Cartão ou boleto')`,
          [
            contractId,
            customerId,
            `CLD-${accountUuid.slice(0, 24)}`,
            free.name,
            free.id,
            clock.day,
            String(onboarding.dueDay),
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
          pricing: 'catalog',
          priceVersionId: initial.priceId,
          setupAmount: 0,
          dueDay: initial.dueDay,
          allowedMethods: ['card', 'boleto'],
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
            allowedMethods: ['card', 'boleto'],
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
  async state(accountUuid: string) {
    const row = await this.binding(accountUuid);
    const [commercial, recurrence, financial] = await Promise.all([
      this.commercial.list(row.customer_id, row.contract_id),
      this.recurrence.get(row.customer_id, row.contract_id),
      this.financial.get(row.customer_id, row.contract_id),
    ]);
    return {
      customerId: row.customer_id,
      contractId: row.contract_id,
      current: commercial.current,
      recurrence,
      financial: financial.financial,
    };
  }
  async portal(accountUuid: string) {
    const row = await this.binding(accountUuid);
    return this.billing.request(
      `/financial/customers/${row.customer_id}/access`,
      { method: 'POST', actorId: actor, body: { expiresInHours: 24 } },
    );
  }
  async change(accountUuid: string, body: unknown, key: string) {
    const parsed = z
      .object({
        planId: z
          .string()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .max(80),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success || !/^[A-Za-z0-9._:-]{1,80}$/.test(key ?? ''))
      throw new BadRequestException('Plano ou chave inválida.');
    const row = await this.binding(accountUuid),
      catalog = await this.plans(),
      plan = catalog.plans.find((v) => v.id === parsed.data.planId);
    if (!plan)
      throw new BadRequestException(
        'Plano não disponível para contratação cloud.',
      );
    const state = await this.state(accountUuid);
    if (
      !state.current ||
      state.current.status !== 'synced' ||
      !state.recurrence?.nextCycleOn
    )
      throw new ConflictException('Recorrência não está disponível.');
    const payload = await this.source.transaction(async (tx) => {
      await tx.query(
        `SELECT id FROM control.customer_contracts WHERE id=$1 FOR UPDATE`,
        [row.contract_id],
      );
      const [prior] = await tx.query<
        Array<{ plan_id: string; payload: unknown }>
      >(
        'SELECT plan_id,payload FROM control.cloud_plan_changes WHERE account_uuid=$1 AND request_key=$2',
        [accountUuid, key],
      );
      if (prior) {
        if (prior.plan_id !== plan.id)
          throw new ConflictException('Chave já usada para outro plano.');
        return prior.payload;
      }
      const value = {
        planId: plan.id,
        pricing: 'catalog',
        priceVersionId: plan.price.id,
        setupAmount: 0,
        dueDay: state.current!.terms.dueDay,
        allowedMethods: state.current!.terms.allowedMethods,
        startsOn: state.current!.terms.startsOn,
        endsOn: state.current!.terms.endsOn,
        effectiveAt: new Date(
          `${state.recurrence!.nextCycleOn}T00:00:00.000-03:00`,
        ).toISOString(),
        overrides: {},
        reason:
          'Alteração de plano solicitada no painel cloud para o próximo ciclo',
      };
      await tx.query(
        'INSERT INTO control.cloud_plan_changes(account_uuid,request_key,plan_id,payload) VALUES($1,$2,$3,$4)',
        [accountUuid, key, plan.id, JSON.stringify(value)],
      );
      return value;
    });
    return this.commercial.publish(
      row.customer_id,
      row.contract_id,
      payload,
      actor,
      `cloud-plan:${key}`,
    );
  }
}
