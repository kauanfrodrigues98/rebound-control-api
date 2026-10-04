import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '../../infra/security/auth.guard';
import { CurrentUser } from '../../infra/security/current-user.decorator';
import type { CurrentControlUser } from '../../infra/security/current-control-user';
import { FinancialOperatorGuard } from '../../billing/financial-access.guard';
import { FinancialHeadersInterceptor } from '../../billing/financial-headers.interceptor';
import { ContractRecurrenceService } from '../application/contract-recurrence.service';
@UseInterceptors(FinancialHeadersInterceptor)
@UseGuards(AuthGuard, FinancialOperatorGuard)
@Controller('billing/customers/:customerId/contracts/:contractId/recurrence')
export class ContractRecurrenceController {
  constructor(private readonly recurrence: ContractRecurrenceService) {}
  @Get() get(
    @Param('customerId', new ParseUUIDPipe()) customer: string,
    @Param('contractId', new ParseUUIDPipe()) contract: string,
  ) {
    return this.recurrence.get(customer, contract);
  }
  @Post() enroll(
    @Param('customerId', new ParseUUIDPipe()) customer: string,
    @Param('contractId', new ParseUUIDPipe()) contract: string,
    @Body() body: unknown,
    @CurrentUser() actor: CurrentControlUser,
    @Headers('idempotency-key') key: string,
  ) {
    return this.recurrence.enroll(customer, contract, body, actor.id, key);
  }
  @Post('process') process(
    @Param('customerId', new ParseUUIDPipe()) customer: string,
    @Param('contractId', new ParseUUIDPipe()) contract: string,
  ) {
    return this.recurrence.process(customer, contract);
  }
  @Put('state') state(
    @Param('customerId', new ParseUUIDPipe()) customer: string,
    @Param('contractId', new ParseUUIDPipe()) contract: string,
    @Body() body: unknown,
    @CurrentUser() actor: CurrentControlUser,
  ) {
    return this.recurrence.state(customer, contract, body, actor.id);
  }
}
