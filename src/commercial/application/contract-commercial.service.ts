import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { BillingAdminClient } from '../../billing/billing-admin.client';
import { LicensingAdminClient } from '../../infra/licensing/licensing-admin.client';
import {
  CONTRACT_REVISION_REPOSITORY,
  contractSnapshotSchema,
  publishContractTermsSchema,
} from '../domain/contract-terms';
import type {
  ContractRevision,
  ContractRevisionRepositoryPort,
} from '../domain/contract-terms';
interface Plan {
  id: string;
  name: string;
  cadence: string;
  active: boolean;
  entitlements: Record<string, boolean | number | string>;
}
interface Price {
  id: string;
  amount: number;
  currency: string;
  intervalMonths: 1 | 3 | 6 | 12;
  effectiveAt: string;
}
export function revisionResponse(row: ContractRevision) {
  return {
    id: row.id,
    sourceVersion: row.sourceVersion,
    terms: row.payload,
    status: row.status,
    attempts: row.attempts,
    billingVersionId: row.billingVersionId,
    syncedAt: row.syncedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
  };
}
function uuid(value: string) {
  const result = z.uuid().safeParse(value);
  if (!result.success) throw new BadRequestException('Identificador inválido.');
  return result.data;
}
@Injectable()
export class ContractCommercialService {
  constructor(
    @Inject(CONTRACT_REVISION_REPOSITORY)
    private readonly revisions: ContractRevisionRepositoryPort,
    private readonly billing: BillingAdminClient,
    private readonly licensing: LicensingAdminClient,
  ) {}
  async list(customerId: string, contractId: string, page = 1) {
    await this.revisions.contract(uuid(customerId), uuid(contractId));
    if (!Number.isInteger(page) || page < 1 || page > 10000)
      throw new BadRequestException('Página inválida.');
    const [rows, current] = await Promise.all([
      this.revisions.list(contractId, page),
      this.revisions.current(contractId),
    ]);
    return {
      versions: rows.slice(0, 25).map(revisionResponse),
      current: current ? revisionResponse(current) : null,
      page,
      hasMore: rows.length > 25,
    };
  }
  async publish(
    customerId: string,
    contractId: string,
    body: unknown,
    actorId: string,
    key: string,
  ) {
    await this.revisions.contract(uuid(customerId), uuid(contractId));
    uuid(actorId);
    const parsed = publishContractTermsSchema.safeParse(body);
    if (!parsed.success || !key || !/^[A-Za-z0-9._:-]{1,128}$/.test(key))
      throw new BadRequestException('Condições comerciais ou chave inválidas.');
    const input = parsed.data;
    const hash = createHash('sha256')
      .update(JSON.stringify({ customerId, contractId, ...input }))
      .digest('hex');
    const existing = await this.revisions.byKey(contractId, key);
    if (existing) {
      if (existing.requestHash !== hash)
        throw new ConflictException('Chave utilizada para outras condições.');
      return revisionResponse(existing);
    }
    const catalog = await this.licensing.request<{ plans: Plan[] }>(
      '/admin/licenses/plans?includeArchived=true',
    );
    const plan = catalog.plans.find((item) => item.id === input.planId);
    if (!plan)
      throw new NotFoundException('Plano não encontrado no Licensing.');
    if (!plan.active)
      throw new ConflictException(
        'Plano arquivado não aceita novas contratações.',
      );
    let amount = input.amount;
    let intervalMonths = input.intervalMonths;
    if (input.pricing === 'catalog') {
      const price = await this.billing.request<Price>(
        `/commercial/plans/${encodeURIComponent(plan.id)}/prices/${input.priceVersionId}`,
      );
      if (
        price.currency !== 'BRL' ||
        new Date(price.effectiveAt) > new Date(input.effectiveAt)
      )
        throw new ConflictException(
          'Preço ainda não vigente na data do contrato.',
        );
      amount = price.amount;
      intervalMonths = price.intervalMonths;
    }
    const draft = {
      customerId,
      contractId,
      planId: plan.id,
      pricing: input.pricing,
      priceVersionId: input.priceVersionId,
      amount,
      intervalMonths,
      currency: 'BRL',
      setupAmount: input.setupAmount,
      dueDay: input.dueDay,
      allowedMethods: [...input.allowedMethods].sort(),
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      effectiveAt: input.effectiveAt,
      reason: input.reason,
      entitlements: {
        ...plan.entitlements,
        ...input.overrides,
        planId: plan.id,
        planName: plan.name,
        cadence: plan.cadence,
      },
    };
    const validation = contractSnapshotSchema.safeParse({
      ...draft,
      sourceRevisionId: '00000000-0000-4000-8000-000000000000',
      sourceVersion: 1,
    });
    if (!validation.success)
      throw new BadRequestException(
        'Condições ou recursos do plano inválidos.',
      );
    const snapshot = {
      ...draft,
      amount: validation.data.amount,
      intervalMonths: validation.data.intervalMonths,
      currency: validation.data.currency,
    };
    const row = await this.revisions.save(
      customerId,
      contractId,
      snapshot,
      actorId,
      key,
      hash,
    );
    // Persist first; failures are shown as pending and retried using the same immutable revision.
    await this.deliver(row.id);
    return revisionResponse(
      (await this.revisions.byId(contractId, row.id)) ?? row,
    );
  }
  async sync(customerId: string, contractId: string, revisionId: string) {
    await this.revisions.contract(uuid(customerId), uuid(contractId));
    uuid(revisionId);
    const row = await this.revisions.byId(contractId, revisionId);
    if (!row) throw new NotFoundException('Revisão não encontrada.');
    if (row.status === 'synced') return revisionResponse(row);
    const delivered = await this.deliver(row.id);
    if (!delivered)
      throw new ConflictException('A revisão já está em sincronização.');
    return revisionResponse(
      (await this.revisions.byId(contractId, row.id)) ?? row,
    );
  }
  async deliver(id?: string) {
    const row = await this.revisions.claim(id);
    if (!row) return false;
    try {
      const result = await this.billing.request<{
        id: string;
        sourceRevisionId: string;
        contractId: string;
      }>('/commercial/contract-terms', {
        method: 'POST',
        body: row.payload,
        actorId: row.createdBy,
        key: row.id,
      });
      if (
        !z.uuid().safeParse(result.id).success ||
        result.sourceRevisionId !== row.id ||
        result.contractId !== row.contractId
      )
        throw new Error('Invalid billing acknowledgement');
      await this.revisions.complete(row, result.id);
    } catch {
      await this.revisions.fail(row);
    }
    return true;
  }
  hasVersions(contractId: string) {
    return this.revisions.hasVersions(contractId);
  }
  async licenseTerms(customerId: string, contractId: string) {
    await this.revisions.contract(customerId, contractId);
    const current = await this.revisions.current(contractId);
    if (!current) return null;
    if (current.status !== 'synced')
      throw new ConflictException(
        'Sincronize as condições do contrato antes de emitir a licença.',
      );
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Recife',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    if (
      current.payload.startsOn > today ||
      (current.payload.endsOn && current.payload.endsOn < today)
    )
      throw new ConflictException('Contrato fora do período de vigência.');
    return {
      ...current.payload,
      entitlements: {
        ...current.payload.entitlements,
        commercialRevisionId: current.id,
        commercialVersion: current.sourceVersion,
      },
    };
  }
}
