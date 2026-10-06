import { CloudPlanChangeService } from './cloud-plan-change.service';
import { CloudPlanChangeWorker } from './cloud-plan-change.worker';
import { RequestModule } from '../requests/request.module';
import { Module } from '@nestjs/common';
import { ContractCommercialModule } from '../commercial/contract-commercial.module';
import { BillingAdminClient } from '../billing/billing-admin.client';
import { LicensingAdminClient } from '../infra/licensing/licensing-admin.client';
import { CloudBillingController } from './cloud-billing.controller';
import { CloudBillingService } from './cloud-billing.service';
import { CloudBillingGuard } from './cloud-billing.guard';
@Module({
  imports: [ContractCommercialModule, RequestModule],
  controllers: [CloudBillingController],
  providers: [
    CloudBillingService,
    CloudPlanChangeService,
    CloudPlanChangeWorker,
    CloudBillingGuard,
    BillingAdminClient,
    LicensingAdminClient,
  ],
})
export class CloudBillingModule {}
