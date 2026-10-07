import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ContractCommercialService } from './contract-commercial.service';
import { LicensingAdminClient } from '../../infra/licensing/licensing-admin.client';
import { env } from '../../config/env';
import { contractSnapshotSchema } from '../domain/contract-terms';
interface CloudPlan {
  id: string;
  name: string;
  cadence: string;
  active: boolean;
  deployment: 'cloud' | 'self_hosted';
  entitlements: Record<string, boolean | number | string>;
}
@Injectable()
export class ContractCourtesyExpiryService {
  private readonly logger = new Logger(ContractCourtesyExpiryService.name);
  constructor(
    private readonly source: DataSource,
    private readonly commercial: ContractCommercialService,
    private readonly licensing: LicensingAdminClient,
  ) {}
  async run(): Promise<void> {
    const rows = await this.source.query<
      Array<{ customer_id: string; contract_id: string; payload: unknown }>
    >(`
      SELECT b.customer_id,b.contract_id,r.payload FROM control.cloud_billing_bindings b
      JOIN control.customer_contracts c ON c.id=b.contract_id
      JOIN LATERAL (SELECT payload FROM control.contract_commercial_revisions WHERE contract_id=c.id AND cancelled_at IS NULL AND (payload->>'effectiveAt')::timestamptz<=now() ORDER BY source_version DESC LIMIT 1) r ON true
      WHERE c.status='ativo' AND r.payload->>'billingMode'='courtesy' AND (r.payload->>'courtesyExpiresAt')::timestamptz<=now()
      AND NOT EXISTS(SELECT 1 FROM control.contract_terminations t WHERE t.contract_id=c.id) ORDER BY b.contract_id LIMIT 25`);
    if (!rows.length) return;
    const catalog = await this.licensing.request<{ plans: CloudPlan[] }>(
      '/admin/licenses/plans',
    );
    const free = catalog.plans.find(
      (plan) =>
        plan.id === env.CLOUD_DEFAULT_PLAN_ID &&
        plan.active &&
        plan.deployment === 'cloud',
    );
    if (!free)
      throw new Error(
        'Configure o plano Cloud Free antes de encerrar cortesias.',
      );
    for (const row of rows) {
      try {
        const terms = contractSnapshotSchema.parse(row.payload);
        const expiresAt = terms.courtesyExpiresAt;
        if (!expiresAt) throw new Error('Cortesia sem data de encerramento.');
        // The recorded expiration makes retries deterministic across workers and failures.
        await this.commercial.publishConfirmedSnapshot(
          row.customer_id,
          row.contract_id,
          {
            ...terms,
            planId: free.id,
            pricing: 'custom',
            billingMode: 'standard',
            courtesyExpiresAt: null,
            courtesyEndedAt: expiresAt,
            priceVersionId: null,
            amount: 0,
            intervalMonths: 1,
            setupAmount: 0,
            effectiveAt: new Date(
              new Date(expiresAt).getTime() + 1,
            ).toISOString(),
            entitlements: {
              ...free.entitlements,
              deployment: free.deployment,
              planId: free.id,
              planName: free.name,
              cadence: free.cadence,
            },
            reason:
              'Cortesia encerrada: retorno ao plano Cloud Free, sem contratação paga.',
          },
          '00000000-0000-4000-8000-000000000005',
          `courtesy-expiry:${terms.sourceRevisionId}`,
        );
      } catch {
        this.logger.warn(
          `Retorno ao Free pendente para o contrato ${row.contract_id}; será repetido.`,
        );
      }
    }
  }
}
