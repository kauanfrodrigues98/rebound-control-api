import {
  Controller,
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
