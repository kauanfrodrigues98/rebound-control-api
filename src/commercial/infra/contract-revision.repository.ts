import { env } from '../../config/env';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import type {
  ContractReference,
  ContractRevision,
  ContractRevisionRepositoryPort,
  ContractSnapshot,
} from '../domain/contract-terms';
const columns = `cancelled_at AS "cancelledAt",id, contract_id AS "contractId", customer_id AS "customerId", source_version AS "sourceVersion", payload,
 request_hash AS "requestHash", created_by AS "createdBy", status, attempts, billing_version_id AS "billingVersionId",
 synced_at AS "syncedAt", last_error AS "lastError", claim_id AS "claimId", created_at AS "createdAt"`;
@Injectable()
export class ContractRevisionRepository implements ContractRevisionRepositoryPort {
  constructor(private readonly source: DataSource) {}
  async contract(customerId: string, contractId: string) {
    const [contract] = await this.source.query<ContractReference[]>(
      `SELECT id, customer_id AS "customerId", status FROM control.customer_contracts WHERE id=$1 AND customer_id=$2`,
      [contractId, customerId],
    );
    if (!contract) throw new NotFoundException('Contrato não encontrado.');
    return contract;
  }
  async byKey(contractId: string, key: string) {
    const [row] = await this.source.query<ContractRevision[]>(
      `SELECT ${columns} FROM control.contract_commercial_revisions WHERE contract_id=$1 AND request_key=$2`,
      [contractId, key],
    );
    return row ?? null;
  }
  async byId(contractId: string, id: string) {
    const [row] = await this.source.query<ContractRevision[]>(
      `SELECT ${columns} FROM control.contract_commercial_revisions WHERE contract_id=$1 AND id=$2`,
      [contractId, id],
    );
    return row ?? null;
  }
  async hasVersions(contractId: string) {
    const [row] = await this.source.query<{ exists: boolean }[]>(
      `SELECT EXISTS(SELECT 1 FROM control.contract_commercial_revisions WHERE contract_id=$1) AS exists`,
      [contractId],
    );
    return row.exists;
  }
  list(contractId: string, page: number) {
    return this.source.query<ContractRevision[]>(
      `SELECT ${columns} FROM control.contract_commercial_revisions WHERE contract_id=$1 ORDER BY source_version DESC LIMIT 26 OFFSET $2`,
      [contractId, (page - 1) * 25],
    );
  }
  async current(contractId: string) {
    const [row] = await this.source.query<ContractRevision[]>(
      `SELECT ${columns} FROM control.contract_commercial_revisions WHERE contract_id=$1 AND cancelled_at IS NULL AND (payload->>'effectiveAt')::timestamptz<=now() ORDER BY source_version DESC LIMIT 1`,
      [contractId],
    );
    return row ?? null;
  }
  async save(
    customerId: string,
    contractId: string,
    input: Omit<ContractSnapshot, 'sourceRevisionId' | 'sourceVersion'>,
    actorId: string,
    key: string,
    hash: string,
    allowHistoricalEffectiveAt = false,
  ) {
    return this.source.transaction(async (manager) => {
      const [contract] = await manager.query<ContractReference[]>(
        `SELECT id, customer_id AS "customerId", status FROM control.customer_contracts WHERE id=$1 AND customer_id=$2 FOR UPDATE`,
        [contractId, customerId],
      );
      if (!contract) throw new NotFoundException('Contrato não encontrado.');
      const [existing] = await manager.query<ContractRevision[]>(
        `SELECT ${columns} FROM control.contract_commercial_revisions WHERE contract_id=$1 AND request_key=$2`,
        [contractId, key],
      );
      if (existing) {
        if (existing.requestHash !== hash)
          throw new ConflictException('Chave utilizada para outras condições.');
        return existing;
      }
      const [termination] = await manager.query(
        'SELECT id FROM control.contract_terminations WHERE contract_id=$1',
        [contractId],
      );
      if (termination)
        throw new ConflictException(
          'Contrato com encerramento solicitado não aceita novas condições.',
        );
      if (['encerrado', 'cancelado'].includes(contract.status))
        throw new ConflictException(
          'Contrato encerrado ou cancelado não aceita novas condições.',
        );
      const [latest] = await manager.query<ContractRevision[]>(
        `SELECT ${columns} FROM control.contract_commercial_revisions WHERE contract_id=$1 ORDER BY source_version DESC LIMIT 1`,
        [contractId],
      );
      const [enrollment] = await manager.query<{ startsOn: string }[]>(
        `SELECT r.payload->>'startsOn' AS "startsOn" FROM control.contract_billing_enrollments e JOIN control.contract_commercial_revisions r ON r.id=e.initial_revision_id WHERE e.contract_id=$1`,
        [contractId],
      );
      if (enrollment && input.startsOn !== enrollment.startsOn)
        throw new ConflictException(
          'Início contratual não pode mudar depois de habilitar a recorrência.',
        );
      const [latestActive] = await manager.query<ContractRevision[]>(
        `SELECT ${columns} FROM control.contract_commercial_revisions WHERE contract_id=$1 AND cancelled_at IS NULL ORDER BY source_version DESC LIMIT 1`,
        [contractId],
      );
      const at = new Date(input.effectiveAt).getTime();
      if (
        input.billingMode === 'courtesy' ||
        latestActive?.payload.billingMode === 'courtesy'
      ) {
        if (contract.status !== 'ativo')
          throw new ConflictException('Cortesia exige contrato ativo.');
        if (at > Date.now() + 1000)
          throw new ConflictException(
            'Concessão ou encerramento de cortesia deve ser imediato.',
          );
        const [pendingChange] = await manager.query<Array<{ id: string }>>(
          "SELECT id FROM control.cloud_plan_change_requests WHERE contract_id=$1 AND status IN ('requested','awaiting_payment','scheduled','activated') LIMIT 1",
          [contractId],
        );
        if (pendingChange)
          throw new ConflictException(
            'Resolva a alteração de plano pendente antes de alterar a cortesia.',
          );
        const [cloudBinding] = await manager.query<
          Array<{ contract_id: string }>
        >(
          'SELECT contract_id FROM control.cloud_billing_bindings WHERE contract_id=$1',
          [contractId],
        );
        if (cloudBinding && input.entitlements.deployment !== 'cloud')
          throw new ConflictException('Conta Cloud exige um plano Cloud.');
        if (
          latestActive?.payload.billingMode === 'courtesy' &&
          input.billingMode !== 'courtesy' &&
          (!cloudBinding ||
            input.planId !== env.CLOUD_DEFAULT_PLAN_ID ||
            input.amount !== 0 ||
            input.setupAmount !== 0)
        )
          throw new ConflictException(
            'Encerre a cortesia pelo comando específico; Cloud retorna ao Free sem contratação paga.',
          );
      }
      if (
        (!allowHistoricalEffectiveAt && at < Date.now() - 60000) ||
        (latestActive &&
          at <= new Date(latestActive.payload.effectiveAt).getTime())
      )
        throw new ConflictException(
          'A vigência deve ser atual/futura e posterior à última versão.',
        );
      const id = randomUUID();
      const version = (latest?.sourceVersion ?? 0) + 1;
      const payload = {
        ...input,
        sourceRevisionId: id,
        sourceVersion: version,
      };
      const [created] = await manager.query<ContractRevision[]>(
        `INSERT INTO control.contract_commercial_revisions(id,contract_id,customer_id,source_version,payload,request_key,request_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${columns}`,
        [
          id,
          contractId,
          customerId,
          version,
          JSON.stringify(payload),
          key,
          hash,
          actorId,
        ],
      );
      if (
        input.billingMode === 'courtesy' ||
        latestActive?.payload.billingMode === 'courtesy'
      ) {
        await manager.query(
          "INSERT INTO control.customer_timeline_entries(id,customer_id,type,title,description) VALUES($1,$2,'contrato',$3,$4)",
          [
            randomUUID(),
            customerId,
            input.billingMode === 'courtesy' &&
            input.courtesyExpiresAt !== input.effectiveAt
              ? 'Cortesia concedida ou atualizada'
              : 'Cortesia encerrada',
            `Contrato ${contractId}. Plano ${input.planId}. Operador ${actorId}. ${input.reason}`,
          ],
        );
        await manager.query(
          'UPDATE control.customer_contracts SET plan_id=$2,plan=$3 WHERE id=$1',
          [
            contractId,
            input.planId,
            String(input.entitlements.planName ?? input.planId),
          ],
        );
      }
      return created;
    });
  }
  async claim(id?: string) {
    return this.source.transaction(async (manager) => {
      const [candidate] = await manager.query<{ id: string }[]>(
        `SELECT id FROM control.contract_commercial_revisions WHERE status='pending' AND cancelled_at IS NULL
        AND (lease_until IS NULL OR lease_until<now()) AND ($1::uuid IS NULL OR id=$1)
        AND ($1::uuid IS NOT NULL OR (attempts<10 AND next_attempt_at<=now())) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [id ?? null],
      );
      if (!candidate) return null;
      const [[claimed]] = await manager.query<[ContractRevision[], number]>(
        `UPDATE control.contract_commercial_revisions SET claim_id=$2, lease_until=now()+interval '2 minutes', attempts=attempts+1 WHERE id=$1 RETURNING ${columns}`,
        [candidate.id, randomUUID()],
      );
      return claimed;
    });
  }
  async complete(revision: ContractRevision, billingVersionId: string) {
    await this.source.query(
      `UPDATE control.contract_commercial_revisions SET status='synced',billing_version_id=$3,synced_at=now(),last_error=NULL,claim_id=NULL,lease_until=NULL WHERE id=$1 AND claim_id=$2`,
      [revision.id, revision.claimId, billingVersionId],
    );
  }
  async fail(revision: ContractRevision) {
    const delay = Math.min(3600, 30 * 2 ** Math.min(revision.attempts, 7));
    await this.source.query(
      `UPDATE control.contract_commercial_revisions SET last_error='billing_unavailable',next_attempt_at=now()+($3::integer*interval '1 second'),claim_id=NULL,lease_until=NULL WHERE id=$1 AND claim_id=$2`,
      [revision.id, revision.claimId, delay],
    );
  }
}
