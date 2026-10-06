import { CurrentUser } from '../../infra/security/current-user.decorator';
import type { CurrentControlUser } from '../../infra/security/current-control-user';
import {
  Controller,
  Body,
  Get,
  Post,
  Param,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '../../infra/security/auth.guard';
import { FinancialOperatorGuard } from '../../billing/financial-access.guard';
import { FinancialHeadersInterceptor } from '../../billing/financial-headers.interceptor';
import { ContractFinancialService } from '../application/contract-financial.service';
@UseGuards(AuthGuard, FinancialOperatorGuard)
@UseInterceptors(FinancialHeadersInterceptor)
@Controller(
  'billing/customers/:customerId/contracts/:contractId/financial-state',
)
export class ContractFinancialController {
  constructor(private readonly service: ContractFinancialService) {}
  @Post('suspension-policy') policy(
    @Param('customerId', new ParseUUIDPipe()) customer: string,
    @Param('contractId', new ParseUUIDPipe()) contract: string,
    @Body() body: unknown,
    @CurrentUser() actor: CurrentControlUser,
  ) {
    return this.service.suspensionPolicy(customer, contract, body, actor.id);
  }
  @Post('renewal') renew(
    @Param('customerId', new ParseUUIDPipe()) customer: string,
    @Param('contractId', new ParseUUIDPipe()) contract: string,
    @Body() body: unknown,
    @CurrentUser() actor: CurrentControlUser,
  ) {
    return this.service.renew(customer, contract, body, actor.id);
  }
  @Get() get(
    @Param('customerId', new ParseUUIDPipe()) customer: string,
    @Param('contractId', new ParseUUIDPipe()) contract: string,
  ) {
    return this.service.get(customer, contract);
  }
  @Post() process(
    @Param('customerId', new ParseUUIDPipe()) customer: string,
    @Param('contractId', new ParseUUIDPipe()) contract: string,
  ) {
    return this.service.process(customer, contract);
  }
}
