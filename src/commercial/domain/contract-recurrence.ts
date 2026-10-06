import { z } from 'zod';
import type { ContractRevision } from './contract-terms';
export const enrollRecurrenceSchema = z
  .object({
    firstCycleOn: z.iso.date(),
    reason: z.string().trim().min(3).max(1000),
    legacyCollectionStopped: z.literal(true),
  })
  .strict();
export const recurrenceAckSchema = z
  .object({
    scheduleId: z.uuid(),
    invoiceId: z.uuid().nullable(),
    nextCycleOn: z.iso.date().nullable(),
    status: z.enum(['active', 'completed', 'paused', 'cancelled']),
  })
  .strict();
export type RecurrenceAck = z.infer<typeof recurrenceAckSchema>;
export interface ContractEnrollment {
  id: string;
  customerId: string;
  contractId: string;
  initialRevisionId: string;
  firstCycleOn: string;
  nextCycleOn: string | null;
  enabled: boolean;
  billingScheduleId: string | null;
  lastInvoiceId: string | null;
  lastError: string | null;
  createdBy: string;
  createdAt: Date;
}
export const CONTRACT_RECURRENCE_REPOSITORY = Symbol(
  'CONTRACT_RECURRENCE_REPOSITORY',
);
export interface ContractRecurrenceRepositoryPort {
  get(
    customerId: string,
    contractId: string,
  ): Promise<ContractEnrollment | null>;
  enroll(
    customerId: string,
    contractId: string,
    firstCycleOn: string,
    reason: string,
    actorId: string,
    key: string,
    hash: string,
  ): Promise<ContractEnrollment>;
  run(
    customerId: string,
    contractId: string,
    action: (
      row: ContractEnrollment,
      current: ContractRevision,
      periodRevisionId: string,
    ) => Promise<RecurrenceAck>,
  ): Promise<ContractEnrollment>;
  state(
    customerId: string,
    contractId: string,
    enabled: boolean,
    reason: string,
    actorId: string,
  ): Promise<ContractEnrollment>;
  due(): Promise<Array<{ customerId: string; contractId: string }>>;
}
