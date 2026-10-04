import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { BillingAdminClient } from '../../billing/billing-admin.client';
import {
  CONTRACT_RECURRENCE_REPOSITORY,
  enrollRecurrenceSchema,
  recurrenceAckSchema,
} from '../domain/contract-recurrence';
import type {
  ContractEnrollment,
  ContractRecurrenceRepositoryPort,
} from '../domain/contract-recurrence';
function uuid(value: string) {
  if (!z.uuid().safeParse(value).success)
    throw new BadRequestException('Identificador inválido.');
  return value;
}
export function enrollmentResponse(row: ContractEnrollment | null) {
  return row
    ? {
        id: row.id,
        firstCycleOn: row.firstCycleOn,
        nextCycleOn: row.nextCycleOn,
        enabled: row.enabled,
        billingScheduleId: row.billingScheduleId,
        lastInvoiceId: row.lastInvoiceId,
        lastError: row.lastError,
        createdAt: row.createdAt,
      }
    : null;
}
@Injectable()
export class ContractRecurrenceService {
  constructor(
    @Inject(CONTRACT_RECURRENCE_REPOSITORY)
    private readonly recurrence: ContractRecurrenceRepositoryPort,
    private readonly billing: BillingAdminClient,
  ) {}
  async get(customer: string, contract: string) {
    return enrollmentResponse(
      await this.recurrence.get(uuid(customer), uuid(contract)),
    );
  }
  async enroll(
    customer: string,
    contract: string,
    body: unknown,
    actor: string,
    key: string,
  ) {
    uuid(customer);
    uuid(contract);
    uuid(actor);
    const parsed = enrollRecurrenceSchema.safeParse(body);
    if (!parsed.success || !/^[A-Za-z0-9._:-]{1,128}$/.test(key ?? ''))
      throw new BadRequestException('Configuração ou chave inválida.');
    const input = parsed.data,
      hash = createHash('sha256')
        .update(JSON.stringify({ customer, contract, ...input }))
        .digest('hex');
    return enrollmentResponse(
      await this.recurrence.enroll(
        customer,
        contract,
        input.firstCycleOn,
        input.reason,
        actor,
        key,
        hash,
      ),
    );
  }
  async process(customer: string, contract: string) {
    return enrollmentResponse(
      await this.recurrence.run(
        uuid(customer),
        uuid(contract),
        async (row, current, periodRevisionId) => {
          const body = {
            customerId: customer,
            contractId: contract,
            enrollmentId: row.id,
            initialRevisionId: row.initialRevisionId,
            currentRevisionId: current.id,
            periodRevisionId,
            firstCycleOn: row.firstCycleOn,
            expectedCycleOn: row.nextCycleOn,
            enrolledAt: row.createdAt.toISOString(),
          };
          return recurrenceAckSchema.parse(
            await this.billing.request('/commercial/recurrence/advance', {
              method: 'POST',
              body,
              actorId: row.createdBy,
              key: `cycle:${row.id}:${row.nextCycleOn}`,
            }),
          );
        },
      ),
    );
  }
  async state(
    customer: string,
    contract: string,
    body: unknown,
    actor: string,
  ) {
    const parsed = z
      .object({
        enabled: z.boolean(),
        reason: z.string().trim().min(3).max(1000),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('Estado da recorrência inválido.');
    return enrollmentResponse(
      await this.recurrence.state(
        uuid(customer),
        uuid(contract),
        parsed.data.enabled,
        parsed.data.reason,
        uuid(actor),
      ),
    );
  }
  async due() {
    return this.recurrence.due();
  }
}
