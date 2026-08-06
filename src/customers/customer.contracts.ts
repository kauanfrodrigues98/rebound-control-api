import { z } from 'zod';

const emptyToNull = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

const optionalText = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable().optional());

const customerTypeSchema = z.enum(['lead', 'prospect', 'cliente', 'parceiro']);
const customerStageSchema = z.enum([
  'prospeccao',
  'negociacao',
  'contratacao',
  'implantacao',
  'operacao',
  'pausado',
  'perdido',
]);
const customerEnvironmentSchema = z.enum(['cloud', 'self-hosted', 'hibrido', 'indefinido']);
const customerPrioritySchema = z.enum(['baixa', 'media', 'alta']);
const contactRoleSchema = z.enum([
  'principal',
  'substituto',
  'tecnico',
  'financeiro',
  'juridico',
  'outro',
]);
const contactPreferenceSchema = z.enum(['email', 'telefone', 'whatsapp', 'call']);
const timelineTypeSchema = z.enum([
  'ligacao',
  'call',
  'proposta',
  'contrato',
  'implantacao',
  'observacao',
]);
const contractStatusSchema = z.enum([
  'rascunho',
  'em_assinatura',
  'ativo',
  'encerrado',
  'cancelado',
]);
const contractCycleSchema = z.enum([
  'mensal',
  'trimestral',
  'semestral',
  'anual',
  'customizado',
]);

export const customerContactSchema = z.object({
  name: optionalText(160),
  email: optionalText(320),
  phone: optionalText(60),
  roleTitle: optionalText(120),
  role: contactRoleSchema.default('principal'),
  preference: contactPreferenceSchema.default('email'),
});

export const createCustomerSchema = z.object({
  name: z.string().trim().min(1).max(180),
  type: customerTypeSchema.default('prospect'),
  stage: customerStageSchema.default('prospeccao'),
  legalName: optionalText(220),
  document: optionalText(80),
  segment: optionalText(120),
  website: optionalText(255),
  commercialOwner: optionalText(160),
  priority: customerPrioritySchema.default('media'),
  expectedValue: optionalText(80),
  expectedEnvironment: customerEnvironmentSchema.default('indefinido'),
  technicalOwner: optionalText(160),
  notes: optionalText(5000),
  contacts: z.array(customerContactSchema).default([]),
});

export const updateCustomerSchema = createCustomerSchema.partial().extend({
  contacts: z.array(customerContactSchema).optional(),
});

export const createCustomerTimelineEntrySchema = z.object({
  type: timelineTypeSchema.default('observacao'),
  title: z.string().trim().min(1).max(180),
  description: optionalText(5000),
  scheduledFor: optionalText(10),
});

export const createCustomerContractSchema = z.object({
  plan: z.string().trim().min(1).max(160),
  planId: optionalText(80),
  status: contractStatusSchema.default('rascunho'),
  cycle: contractCycleSchema.default('mensal'),
  monthlyValue: optionalText(80),
  setupValue: optionalText(80),
  startsOn: optionalText(10),
  endsOn: optionalText(10),
  dueDay: optionalText(2),
  paymentMethod: optionalText(120),
  signingContact: optionalText(160),
  notes: optionalText(5000),
});

export const updateCustomerContractSchema = createCustomerContractSchema.partial();

export type CreateCustomerBody = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerBody = z.infer<typeof updateCustomerSchema>;
export type CreateCustomerContactBody = z.infer<typeof customerContactSchema>;
export type CreateCustomerTimelineEntryBody = z.infer<
  typeof createCustomerTimelineEntrySchema
>;
export type CreateCustomerContractBody = z.infer<typeof createCustomerContractSchema>;
export type UpdateCustomerContractBody = z.infer<typeof updateCustomerContractSchema>;
