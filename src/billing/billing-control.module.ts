import { CommercialPriceController } from './commercial-price.controller';
import { LicensingAdminClient } from '../infra/licensing/licensing-admin.client';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth.module';
import { BillingAdminClient } from './billing-admin.client';
import { BillingControlController } from './billing-control.controller';
import { FinancialPortalController } from './financial-portal.controller';
import {
  FinancialOperatorGuard,
  FinancialOriginGuard,
} from './financial-access.guard';
@Module({
  imports: [AuthModule],
  controllers: [
    BillingControlController,
    FinancialPortalController,
    CommercialPriceController,
  ],
  providers: [
    LicensingAdminClient,
    BillingAdminClient,
    FinancialOperatorGuard,
    FinancialOriginGuard,
  ],
})
export class BillingControlModule {}
