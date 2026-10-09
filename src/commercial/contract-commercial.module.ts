import { ContractCurrencyService } from './application/contract-currency.service';
import { ContractCourtesyExpiryService } from './application/contract-courtesy-expiry.service';
import { ContractCancellationService } from './application/contract-cancellation.service';
import { ContractFinancialService } from './application/contract-financial.service';
import { FinancialNoticeWorker } from './application/financial-notice.worker';
import { ContractFinancialWorker } from './application/contract-financial.worker';
import { ContractFinancialController } from './presentation/contract-financial.controller';
import { ContractRecurrenceController } from './presentation/contract-recurrence.controller';
import { ContractRecurrenceService } from './application/contract-recurrence.service';
import { ContractRecurrenceWorker } from './application/contract-recurrence.worker';
import { ContractRecurrenceRepository } from './infra/contract-recurrence.repository';
import { CONTRACT_RECURRENCE_REPOSITORY } from './domain/contract-recurrence';
import { ContractTerminationEmailWorker } from './application/contract-termination-email.worker';
import { ContractTerminationService } from './application/contract-termination.service';
import { ContractTerminationWorker } from './application/contract-termination.worker';
import { ContractTerminationController } from './presentation/contract-termination.controller';
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
  controllers: [
    ContractTerminationController,
    ContractFinancialController,
    ContractCommercialController,
    ContractRecurrenceController,
  ],
  providers: [
    ContractCurrencyService,
    ContractCourtesyExpiryService,
    ContractTerminationEmailWorker,
    ContractTerminationService,
    ContractTerminationWorker,
    ContractCancellationService,
    ContractFinancialService,
    ContractFinancialWorker,
    FinancialNoticeWorker,
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
  exports: [
    ContractTerminationService,
    ContractCancellationService,
    ContractCommercialService,
    ContractRecurrenceService,
    ContractFinancialService,
  ],
})
export class ContractCommercialModule {}
