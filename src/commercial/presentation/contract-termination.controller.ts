import {
  Body,
  Controller,
  Get,
  Post,
  Headers,
  Param,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '../../infra/security/auth.guard';
import { FinancialOperatorGuard } from '../../billing/financial-access.guard';
import { FinancialHeadersInterceptor } from '../../billing/financial-headers.interceptor';
import { CurrentUser } from '../../infra/security/current-user.decorator';
import type { CurrentControlUser } from '../../infra/security/current-control-user';
import { ContractTerminationService } from '../application/contract-termination.service';
@UseGuards(AuthGuard, FinancialOperatorGuard)
@UseInterceptors(FinancialHeadersInterceptor)
@Controller('billing/customers/:customerId/contracts/:contractId/termination')
export class ContractTerminationController {
  constructor(private readonly service: ContractTerminationService) {}
  @Get() get(
    @Param('customerId', new ParseUUIDPipe()) customer: string,
    @Param('contractId', new ParseUUIDPipe()) contract: string,
  ) {
    return this.service.get(customer, contract);
  }
  @Post() request(
    @Param('customerId', new ParseUUIDPipe()) customer: string,
    @Param('contractId', new ParseUUIDPipe()) contract: string,
    @Body() body: unknown,
    @CurrentUser() actor: CurrentControlUser,
    @Headers('idempotency-key') key: string,
  ) {
    return this.service.request(customer, contract, body, actor.id, key);
  }
}
