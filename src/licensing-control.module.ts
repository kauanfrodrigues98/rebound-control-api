import { Module } from '@nestjs/common';
import { AuthModule } from './auth.module';
import { LicensingAdminClient } from './infra/licensing/licensing-admin.client';
import { LicensingControlController } from './presentation/http/licensing-control.controller';

@Module({
  imports: [AuthModule],
  controllers: [LicensingControlController],
  providers: [LicensingAdminClient],
})
export class LicensingControlModule {}
