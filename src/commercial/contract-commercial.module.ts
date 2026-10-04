import { Module } from '@nestjs/common';
import { AuthModule } from '../auth.module';
import { BillingAdminClient } from '../billing/billing-admin.client';
import { LicensingAdminClient } from '../infra/licensing/licensing-admin.client';
import { FinancialOperatorGuard } from '../billing/financial-access.guard';
import { ContractCommercialService } from './application/contract-commercial.service';
import { ContractSyncWorker } from './application/contract-sync.worker';
import { ContractRevisionRepository } from './infra/contract-revision.repository';
import { CONTRACT_REVISION_REPOSITORY } from './domain/contract-terms';
import { ContractCommercialController } from './presentation/contract-commercial.controller';
@Module({
  imports: [AuthModule],
  controllers: [ContractCommercialController],
  providers: [
    BillingAdminClient,
    LicensingAdminClient,
    FinancialOperatorGuard,
    ContractCommercialService,
    ContractSyncWorker,
    {
      provide: CONTRACT_REVISION_REPOSITORY,
      useClass: ContractRevisionRepository,
    },
  ],
  exports: [ContractCommercialService],
})
export class ContractCommercialModule {}
