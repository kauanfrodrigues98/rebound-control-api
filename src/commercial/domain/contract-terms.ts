import { z } from 'zod';
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
    amount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    setupAmount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    currency: z.literal('BRL'),
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
    entitlements: z
      .record(
        z.string().min(1).max(80),
        z.union([z.boolean(), z.number().finite(), z.string().max(500)]),
      )
      .refine((v) => Object.keys(v).length > 0 && Object.keys(v).length <= 100),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict()
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
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
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
  })
  .strict();
export const publishContractTermsSchema = z
  .object({
    planId: contractSnapshotSchema.shape.planId,
    pricing: z.enum(['catalog', 'custom']),
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
  ): Promise<ContractRevision>;
  current(contractId: string): Promise<ContractRevision | null>;
  claim(id?: string): Promise<ContractRevision | null>;
  complete(revision: ContractRevision, billingVersionId: string): Promise<void>;
  fail(revision: ContractRevision): Promise<void>;
}
