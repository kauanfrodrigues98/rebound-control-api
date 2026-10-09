import { z } from 'zod';
export const overageSchema = z
  .object({
    dlq_events: z.number().int().positive().max(100000000).optional(),
    ai_analysis: z.number().int().positive().max(100000000).optional(),
    payload_replays: z.number().int().positive().max(100000000).optional(),
  })
  .strict();
export const contractSnapshotSchema = z
  .object({
    sourceRevisionId: z.uuid(),
    sourceVersion: z.number().int().positive(),
    customerId: z.uuid(),
    contractId: z.uuid(),
    planId: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(80),
    priceVersionId: z.uuid().nullable(),
    pricing: z.enum(['catalog', 'custom']),
    billingMode: z.enum(['standard', 'courtesy']).optional(),
    courtesyExpiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
    courtesyEndedAt: z.iso.datetime({ offset: true }).optional(),
    amount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    setupAmount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    currency: z.enum(['BRL', 'USD']),
    currencyChange: z
      .object({
        from: z.enum(['BRL', 'USD']),
        requestedBy: z.string().trim().min(3).max(200),
      })
      .strict()
      .optional(),

    intervalMonths: z.union([
      z.literal(1),
      z.literal(3),
      z.literal(6),
      z.literal(12),
    ]),
    dueDay: z.number().int().min(1).max(31),
    allowedMethods: z
      .array(z.enum(['card', 'boleto', 'external']))
      .min(1)
      .max(3)
      .refine((v) => new Set(v).size === v.length),
    startsOn: z.iso.date(),
    endsOn: z.iso.date().nullable(),
    effectiveAt: z.iso.datetime({ offset: true }),
    overage: overageSchema.optional(),
    entitlements: z
      .record(
        z.string().min(1).max(80),
        z.union([z.boolean(), z.number().finite(), z.string().max(500)]),
      )
      .refine((v) => Object.keys(v).length > 0 && Object.keys(v).length <= 100),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict()
  .refine(
    (v) =>
      v.billingMode !== 'courtesy' ||
      (v.pricing === 'custom' &&
        v.amount === 0 &&
        v.setupAmount === 0 &&
        (!v.courtesyExpiresAt ||
          new Date(v.courtesyExpiresAt) >= new Date(v.effectiveAt))),
    {
      message:
        'Cortesia exige preço e implantação zero e validade posterior à concessão.',
    },
  )
  .refine((v) => v.billingMode === 'courtesy' || v.courtesyExpiresAt == null, {
    message: 'Validade de cortesia inválida.',
  })
  .refine(
    (v) =>
      !v.courtesyEndedAt ||
      (v.billingMode === 'standard' &&
        v.pricing === 'custom' &&
        v.amount === 0 &&
        v.setupAmount === 0),
    { message: 'Retorno de cortesia exige condições gratuitas.' },
  )
  .refine(
    (v) =>
      !v.overage ||
      Object.keys(v.overage).length === 0 ||
      (v.billingMode !== 'courtesy' &&
        !['free', 'cloud-free'].includes(v.planId) &&
        v.entitlements.deployment === 'cloud'),
    { message: 'Excedentes faturáveis exigem contrato Cloud pago.' },
  )
  .refine((v) => v.currency === 'BRL' || !v.allowedMethods.includes('boleto'), {
    message: 'Boleto está disponível somente em BRL.',
  })
  .refine((v) => !v.endsOn || v.endsOn >= v.startsOn, {
    message: 'Término anterior ao início.',
  })
  .refine(
    (v) =>
      v.pricing === 'catalog'
        ? v.priceVersionId !== null
        : v.priceVersionId === null,
    { message: 'Origem do preço inválida.' },
  )
  .refine(
    (v) =>
      !v.endsOn ||
      new Date(v.effectiveAt) <= new Date(`${v.endsOn}T23:59:59.999-03:00`),
    { message: 'Vigência posterior ao término do contrato.' },
  );
export type ContractSnapshot = z.infer<typeof contractSnapshotSchema>;

const limit = z.union([
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  z.literal('unlimited'),
]);
export const entitlementOverridesSchema = z
  .object({
    maxUsers: limit.optional(),
    maxProjects: limit.optional(),
    maxMonthlyEvents: limit.optional(),
    maxAiAnalysisMonthly: limit.optional(),
    maxPayloadReplaysMonthly: limit.optional(),
    retentionDays: z.number().int().positive().max(3650).optional(),
    supportSlaHours: z.number().int().positive().max(8760).optional(),
    aiEnabled: z.boolean().optional(),
    automaticReplayEnabled: z.boolean().optional(),
    manualReplayEnabled: z.boolean().optional(),
  })
  .strict();
export const publishContractTermsSchema = z
  .object({
    planId: contractSnapshotSchema.shape.planId,
    currency: z.enum(['BRL', 'USD']).default('BRL'),
    pricing: z.enum(['catalog', 'custom']),
    billingMode: z.enum(['standard', 'courtesy']).optional(),
    courtesyExpiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
    priceVersionId: z.uuid().nullable(),
    amount: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    intervalMonths: contractSnapshotSchema.shape.intervalMonths.optional(),
    setupAmount: contractSnapshotSchema.shape.setupAmount,
    dueDay: contractSnapshotSchema.shape.dueDay,
    allowedMethods: contractSnapshotSchema.shape.allowedMethods,
    startsOn: z.iso.date(),
    endsOn: z.iso.date().nullable(),
    effectiveAt: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value).toISOString()),
    overage: overageSchema.optional(),
    overrides: entitlementOverridesSchema.default({}),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict()
  .refine((v) => !v.endsOn || v.endsOn >= v.startsOn)
  .refine((v) =>
    v.pricing === 'catalog'
      ? v.priceVersionId !== null &&
        v.amount === undefined &&
        v.intervalMonths === undefined
      : v.priceVersionId === null &&
        v.amount !== undefined &&
        v.intervalMonths !== undefined,
  );
export type PublishContractTerms = z.infer<typeof publishContractTermsSchema>;
export interface ContractReference {
  id: string;
  customerId: string;
  status: string;
}
export interface ContractRevision {
  cancelledAt?: Date | null;
  id: string;
  contractId: string;
  customerId: string;
  sourceVersion: number;
  payload: ContractSnapshot;
  requestHash: string;
  createdBy: string;
  status: 'pending' | 'synced';
  attempts: number;
  billingVersionId: string | null;
  syncedAt: Date | null;
  lastError: string | null;
  claimId: string | null;
  createdAt: Date;
}
export const CONTRACT_REVISION_REPOSITORY = Symbol(
  'CONTRACT_REVISION_REPOSITORY',
);
export interface ContractRevisionRepositoryPort {
  contract(customerId: string, contractId: string): Promise<ContractReference>;
  byKey(contractId: string, key: string): Promise<ContractRevision | null>;
  byId(contractId: string, id: string): Promise<ContractRevision | null>;
  hasVersions(contractId: string): Promise<boolean>;
  list(contractId: string, page: number): Promise<ContractRevision[]>;
  save(
    customerId: string,
    contractId: string,
    input: Omit<ContractSnapshot, 'sourceRevisionId' | 'sourceVersion'>,
    actorId: string,
    key: string,
    hash: string,
    allowHistoricalEffectiveAt?: boolean,
  ): Promise<ContractRevision>;
  current(contractId: string): Promise<ContractRevision | null>;
  claim(id?: string): Promise<ContractRevision | null>;
  complete(revision: ContractRevision, billingVersionId: string): Promise<void>;
  fail(revision: ContractRevision): Promise<void>;
}
