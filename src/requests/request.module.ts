import { Module } from '@nestjs/common';
import { AuthModule } from '../auth.module';
import { FinancialOperatorGuard } from '../billing/financial-access.guard';
import { RequestController } from './request.controller';
import { RequestRepository } from './request.repository';
import { RequestService } from './request.service';
import { RequestEmailWorker } from './request-email.worker';
@Module({
  imports: [AuthModule],
  controllers: [RequestController],
  providers: [
    RequestService,
    RequestRepository,
    RequestEmailWorker,
    FinancialOperatorGuard,
  ],
  exports: [RequestService],
})
export class RequestModule {}
