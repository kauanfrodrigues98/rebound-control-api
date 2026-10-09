import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { BillingAdminClient } from '../../billing/billing-admin.client';
import {
  ContractCommercialService,
  revisionResponse,
} from './contract-commercial.service';
import { ContractFinancialService } from './contract-financial.service';
import {
  CONTRACT_REVISION_REPOSITORY,
  contractSnapshotSchema,
  overageSchema,
} from '../domain/contract-terms';
import type { ContractRevisionRepositoryPort } from '../domain/contract-terms';
export const currencyChangeInput = z
  .object({
    currency: z.enum(['BRL', 'USD']),
    requestedBy: z.string().trim().min(3).max(200),
    reason: z.string().trim().min(3).max(1000),
    overage: overageSchema.default({}),
  })
  .strict();
@Injectable()
export class ContractCurrencyService {
  constructor(
    @Inject(CONTRACT_REVISION_REPOSITORY)
    private readonly revisions: ContractRevisionRepositoryPort,
    private readonly billing: BillingAdminClient,
    private readonly commercial: ContractCommercialService,
    private readonly financial: ContractFinancialService,
  ) {}
  async preview(customerId: string, contractId: string, body: unknown) {
    const input = currencyChangeInput.safeParse(body);
    if (!input.success)
      throw new BadRequestException(
        'Informe moeda, solicitante/chamado, motivo e tarifas de excedente.',
      );
    const contract = await this.revisions.contract(customerId, contractId);
    const current = await this.revisions.current(contractId);
    if (
      contract.status !== 'ativo' ||
      !current ||
      current.status !== 'synced' ||
      current.payload.billingMode === 'courtesy'
    )
      throw new ConflictException(
        'A troca exige contrato ativo e sincronizado, fora de cortesia.',
      );
    if (input.data.currency === current.payload.currency)
      throw new ConflictException('A conta já utiliza esta moeda.');
    if (
      !isDeepStrictEqual(
        Object.keys(input.data.overage).sort(),
        Object.keys(current.payload.overage ?? {}).sort(),
      )
    )
      throw new BadRequestException(
        'Informe uma nova tarifa para cada excedente já contratado. As políticas e franquias serão preservadas.',
      );
    const { financial } = await this.financial.get(customerId, contractId);
    const next = financial.nextCycleOn;
    if (
      !next ||
      financial.overdueSince ||
      (financial.recurrenceState && financial.recurrenceState !== 'active') ||
      new Date(`${next}T00:00:00.000-03:00`) <= new Date()
    )
      throw new ConflictException(
        'Regularize as pendências e aguarde uma próxima competência futura antes de trocar a moeda.',
      );
    const effectiveAt = new Date(`${next}T00:00:00.000-03:00`).toISOString();
    const catalog = await this.billing.request<{
      current: {
        id: string;
        amount: number;
        currency: string;
        intervalMonths: number;
      } | null;
    }>(
      `/commercial/plans/${encodeURIComponent(current.payload.planId)}/prices?currency=${input.data.currency}`,
    );
    const price = catalog.current;
    if (
      !price ||
      price.currency !== input.data.currency ||
      price.intervalMonths !== current.payload.intervalMonths
    )
      throw new ConflictException(
        'Cadastre um preço vigente do mesmo plano e cadência na moeda solicitada.',
      );
    const base = { ...current.payload };
    delete base.courtesyEndedAt;
    const target = contractSnapshotSchema.parse({
      ...base,
      sourceRevisionId: current.id,
      sourceVersion: current.sourceVersion,
      currency: input.data.currency,
      pricing: 'catalog',
      priceVersionId: price.id,
      amount: price.amount,
      setupAmount: 0,
      effectiveAt,
      reason: input.data.reason,
      overage: input.data.overage,
      allowedMethods: base.allowedMethods.filter(
        (method) => input.data.currency === 'BRL' || method !== 'boleto',
      ),
      currencyChange: {
        from: base.currency,
        requestedBy: input.data.requestedBy,
      },
    });
    const hash = createHash('sha256')
      .update(JSON.stringify(target))
      .digest('hex');
    return {
      hash,
      effectiveAt,
      from: base.currency,
      currency: target.currency,
      amount: target.amount,
      intervalMonths: target.intervalMonths,
      overage: target.overage,
      target,
    };
  }
  async schedule(
    customer: string,
    contract: string,
    body: unknown,
    actor: string,
    key: string,
  ) {
    const parsed = currencyChangeInput
      .extend({ expectedHash: z.string().regex(/^[a-f0-9]{64}$/) })
      .safeParse(body);
    if (
      !parsed.success ||
      !z.uuid().safeParse(actor).success ||
      !/^[A-Za-z0-9._:-]{1,128}$/.test(key ?? '')
    )
      throw new BadRequestException('Solicitação ou confirmação inválida.');
    const { expectedHash, ...input } = parsed.data;
    await this.revisions.contract(customer, contract);
    const prior = await this.revisions.byKey(contract, key);
    if (prior) {
      if (
        prior.cancelledAt ||
        !prior.payload.currencyChange ||
        prior.payload.currency !== input.currency ||
        prior.payload.currencyChange.requestedBy !== input.requestedBy ||
        prior.payload.reason !== input.reason ||
        !isDeepStrictEqual(prior.payload.overage ?? {}, input.overage)
      )
        throw new ConflictException(
          'Chave já utilizada para outra solicitação.',
        );
      if (prior.status !== 'synced') await this.commercial.deliver(prior.id);
      return revisionResponse(
        (await this.revisions.byId(contract, prior.id)) ?? prior,
      );
    }
    const quote = await this.preview(customer, contract, input);
    if (quote.hash !== expectedHash)
      throw new ConflictException(
        'Os valores ou a competência mudaram. Consulte e confirme a prévia novamente.',
      );
    return this.commercial.publishConfirmedSnapshot(
      customer,
      contract,
      quote.target,
      actor,
      key,
    );
  }
}
