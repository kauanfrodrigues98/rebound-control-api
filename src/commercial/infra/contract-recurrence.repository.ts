import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import type {
  ContractEnrollment,
  ContractRecurrenceRepositoryPort,
  RecurrenceAck,
} from '../domain/contract-recurrence';
import type { ContractRevision } from '../domain/contract-terms';
const columns = `id,customer_id AS "customerId",contract_id AS "contractId",initial_revision_id AS "initialRevisionId",
 first_cycle_on::text AS "firstCycleOn",next_cycle_on::text AS "nextCycleOn",enabled,billing_schedule_id AS "billingScheduleId",last_invoice_id AS "lastInvoiceId",
 last_error AS "lastError",created_by AS "createdBy",created_at AS "createdAt"`;
const currentColumns = `id,source_version AS "sourceVersion",payload,status`;
@Injectable()
export class ContractRecurrenceRepository implements ContractRecurrenceRepositoryPort {
  constructor(private readonly source: DataSource) {}
  async get(customerId: string, contractId: string) {
    const [contract] = await this.source.query<{ id: string }[]>(
      `SELECT id FROM control.customer_contracts WHERE id=$1 AND customer_id=$2`,
      [contractId, customerId],
    );
    if (!contract) throw new NotFoundException('Contrato não encontrado.');
    const [row] = await this.source.query<ContractEnrollment[]>(
      `SELECT ${columns} FROM control.contract_billing_enrollments WHERE contract_id=$1`,
      [contractId],
    );
    return row ?? null;
  }
  async enroll(
    customerId: string,
    contractId: string,
    firstCycleOn: string,
    reason: string,
    actorId: string,
    key: string,
    hash: string,
  ) {
    return this.source.transaction(async (manager) => {
      const [contract] = await manager.query<{ status: string }[]>(
        `SELECT status FROM control.customer_contracts WHERE id=$1 AND customer_id=$2 FOR UPDATE`,
        [contractId, customerId],
      );
      if (!contract) throw new NotFoundException('Contrato não encontrado.');
      const [existing] = await manager.query<
        Array<ContractEnrollment & { requestHash: string }>
      >(
        `SELECT ${columns},request_hash AS "requestHash" FROM control.contract_billing_enrollments WHERE contract_id=$1`,
        [contractId],
      );
      if (existing) {
        if (existing.requestHash !== hash)
          throw new ConflictException(
            'Recorrência já possui outra configuração inicial.',
          );
        return existing;
      }
      if (contract.status !== 'ativo')
        throw new ConflictException(
          'Somente contratos ativos podem iniciar recorrência.',
        );
      const [current] = await manager.query<ContractRevision[]>(
        `SELECT ${currentColumns} FROM control.contract_commercial_revisions WHERE contract_id=$1 AND cancelled_at IS NULL AND (payload->>'effectiveAt')::timestamptz<=now() ORDER BY source_version DESC LIMIT 1`,
        [contractId],
      );
      const [clock] = await manager.query<{ today: string }[]>(
        `SELECT (now() AT TIME ZONE 'America/Recife')::date::text AS today`,
      );
      if (!current || current.status !== 'synced')
        throw new ConflictException(
          'Confirme as condições vigentes no Billing antes de habilitar recorrência.',
        );
      if (
        firstCycleOn < clock.today ||
        firstCycleOn < current.payload.startsOn ||
        (current.payload.endsOn && firstCycleOn > current.payload.endsOn)
      )
        throw new ConflictException(
          'Primeira competência deve ser atual/futura e estar dentro do contrato.',
        );
      const id = randomUUID();
      const [created] = await manager.query<ContractEnrollment[]>(
        `INSERT INTO control.contract_billing_enrollments(id,customer_id,contract_id,initial_revision_id,first_cycle_on,next_cycle_on,request_key,request_hash,reason,created_by) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9) RETURNING ${columns}`,
        [
          id,
          customerId,
          contractId,
          current.id,
          firstCycleOn,
          key,
          hash,
          reason,
          actorId,
        ],
      );
      await manager.query(
        `INSERT INTO control.contract_billing_events(id,enrollment_id,action,actor_id,payload) VALUES($1,$2,'enabled',$3,$4)`,
        [
          randomUUID(),
          id,
          actorId,
          JSON.stringify({
            firstCycleOn,
            reason,
            legacyCollectionStopped: true,
          }),
        ],
      );
      return created;
    });
  }
  async run(
    customerId: string,
    contractId: string,
    action: (
      row: ContractEnrollment,
      current: ContractRevision,
      periodRevisionId: string,
    ) => Promise<RecurrenceAck>,
  ) {
    return this.source.transaction(async (manager) => {
      // Lock the same source contract used by edits and term publication, through the remote commit.
      const [contract] = await manager.query<{ status: string }[]>(
        `SELECT status FROM control.customer_contracts WHERE id=$1 AND customer_id=$2 FOR UPDATE`,
        [contractId, customerId],
      );
      if (!contract) throw new NotFoundException('Contrato não encontrado.');
      const [row] = await manager.query<ContractEnrollment[]>(
        `SELECT ${columns} FROM control.contract_billing_enrollments WHERE contract_id=$1 FOR UPDATE`,
        [contractId],
      );
      if (!row)
        throw new NotFoundException('Recorrência ainda não habilitada.');
      if (contract.status !== 'ativo')
        throw new ConflictException(
          'Contrato não está ativo; nenhuma competência será gerada.',
        );
      const [termination] = await manager.query<{ effective_at: Date }[]>(
        'SELECT effective_at FROM control.contract_terminations WHERE contract_id=$1',
        [contractId],
      );
      if (
        termination &&
        (!row.nextCycleOn ||
          new Date(`${row.nextCycleOn}T00:00:00.000-03:00`) >=
            termination.effective_at)
      )
        return row;
      if (!row.enabled || !row.nextCycleOn) return row;
      const [decision] = await manager.query(
        'SELECT payload FROM control.financial_decisions WHERE contract_id=$1 ORDER BY source_version DESC LIMIT 1',
        [contractId],
      );
      if (
        decision?.payload.recurrenceState &&
        decision.payload.recurrenceState !== 'active'
      )
        return row;
      const [current] = await manager.query<ContractRevision[]>(
        `SELECT ${currentColumns} FROM control.contract_commercial_revisions WHERE contract_id=$1 AND cancelled_at IS NULL AND (payload->>'effectiveAt')::timestamptz<=now() ORDER BY source_version DESC LIMIT 1`,
        [contractId],
      );
      try {
        if (!current || current.status !== 'synced')
          throw new ConflictException('Condições vigentes pendentes.');
        let periodRevisionId = row.initialRevisionId;
        if (row.nextCycleOn !== row.firstCycleOn) {
          const [period] = await manager.query<ContractRevision[]>(
            `SELECT ${currentColumns} FROM control.contract_commercial_revisions WHERE contract_id=$1 AND cancelled_at IS NULL AND (payload->>'effectiveAt')::timestamptz<=($2::date::timestamp AT TIME ZONE 'America/Recife') ORDER BY source_version DESC LIMIT 1`,
            [contractId, row.nextCycleOn],
          );
          if (!period || period.status !== 'synced')
            throw new ConflictException('Condições da competência pendentes.');
          periodRevisionId = period.id;
        }
        const ack = await action(row, current, periodRevisionId);
        if (row.billingScheduleId && row.billingScheduleId !== ack.scheduleId)
          throw new ConflictException('Identidade da recorrência divergente.');
        const [[updated]] = await manager.query<[ContractEnrollment[], number]>(
          `UPDATE control.contract_billing_enrollments SET billing_schedule_id=$2,next_cycle_on=$3,last_invoice_id=COALESCE($4,last_invoice_id),last_error=NULL,next_attempt_at=now()+interval '1 minute' WHERE id=$1 RETURNING ${columns}`,
          [row.id, ack.scheduleId, ack.nextCycleOn, ack.invoiceId],
        );
        return updated;
      } catch {
        const [[pending]] = await manager.query<[ContractEnrollment[], number]>(
          `UPDATE control.contract_billing_enrollments SET last_error='billing_pending',next_attempt_at=now()+interval '5 minutes' WHERE id=$1 RETURNING ${columns}`,
          [row.id],
        );
        return pending;
      }
    });
  }
  async state(
    customerId: string,
    contractId: string,
    enabled: boolean,
    reason: string,
    actorId: string,
  ) {
    return this.source.transaction(async (manager) => {
      const [contract] = await manager.query<{ status: string }[]>(
        `SELECT status FROM control.customer_contracts WHERE id=$1 AND customer_id=$2 FOR UPDATE`,
        [contractId, customerId],
      );
      if (!contract) throw new NotFoundException('Contrato não encontrado.');
      if (enabled && contract.status !== 'ativo')
        throw new ConflictException('Contrato não está ativo.');
      const [[row]] = await manager.query<[ContractEnrollment[], number]>(
        `UPDATE control.contract_billing_enrollments SET enabled=$3,next_attempt_at=now() WHERE contract_id=$1 AND customer_id=$2 RETURNING ${columns}`,
        [contractId, customerId, enabled],
      );
      if (!row)
        throw new NotFoundException('Recorrência ainda não habilitada.');
      await manager.query(
        `INSERT INTO control.contract_billing_events(id,enrollment_id,action,actor_id,payload) VALUES($1,$2,$3,$4,$5)`,
        [
          randomUUID(),
          row.id,
          enabled ? 'resumed' : 'paused',
          actorId,
          JSON.stringify({ reason }),
        ],
      );
      return row;
    });
  }
  due() {
    return this.source.query<Array<{ customerId: string; contractId: string }>>(
      `SELECT e.customer_id AS "customerId",e.contract_id AS "contractId" FROM control.contract_billing_enrollments e JOIN control.customer_contracts c ON c.id=e.contract_id WHERE c.status='ativo' AND e.enabled AND NOT EXISTS(SELECT 1 FROM control.financial_decisions f WHERE f.contract_id=c.id AND f.source_version=(SELECT max(g.source_version) FROM control.financial_decisions g WHERE g.contract_id=c.id) AND f.payload->>'recurrenceState' IN ('paused','renewal_required')) AND NOT EXISTS(SELECT 1 FROM control.contract_terminations t WHERE t.contract_id=c.id AND (e.next_cycle_on::timestamp AT TIME ZONE 'America/Recife')>=t.effective_at) AND e.next_cycle_on<=(now() AT TIME ZONE 'America/Recife')::date AND e.next_attempt_at<=now() ORDER BY e.next_attempt_at,e.contract_id LIMIT 10`,
    );
  }
}
