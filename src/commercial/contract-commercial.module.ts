import { ContractRecurrenceController } from './presentation/contract-recurrence.controller';
import { ContractRecurrenceService } from './application/contract-recurrence.service';
import { ContractRecurrenceWorker } from './application/contract-recurrence.worker';
import { ContractRecurrenceRepository } from './infra/contract-recurrence.repository';
import { CONTRACT_RECURRENCE_REPOSITORY } from './domain/contract-recurrence';
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
  controllers: [ContractCommercialController, ContractRecurrenceController],
  providers: [
    BillingAdminClient,
    LicensingAdminClient,
    FinancialOperatorGuard,
    ContractCommercialService,
    ContractSyncWorker,
    ContractRecurrenceService,
    ContractRecurrenceWorker,
    {
      provide: CONTRACT_RECURRENCE_REPOSITORY,
      useClass: ContractRecurrenceRepository,
    },
    {
      provide: CONTRACT_REVISION_REPOSITORY,
      useClass: ContractRevisionRepository,
    },
  ],
  exports: [ContractCommercialService],
})
export class ContractCommercialModule {}
