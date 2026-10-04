import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '../../infra/security/auth.guard';
import { CurrentUser } from '../../infra/security/current-user.decorator';
import type { CurrentControlUser } from '../../infra/security/current-control-user';
import { FinancialOperatorGuard } from '../../billing/financial-access.guard';
import { FinancialHeadersInterceptor } from '../../billing/financial-headers.interceptor';
import { ContractCommercialService } from '../application/contract-commercial.service';
@UseInterceptors(FinancialHeadersInterceptor)
@UseGuards(AuthGuard, FinancialOperatorGuard)
@Controller('billing/customers/:customerId/contracts/:contractId/terms')
export class ContractCommercialController {
  constructor(private readonly commercial: ContractCommercialService) {}
  @Get()
  list(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
    @Query('page') page?: string,
  ) {
    return this.commercial.list(customerId, contractId, Number(page ?? 1));
  }
  @Post()
  publish(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
    @Body() body: unknown,
    @CurrentUser() actor: CurrentControlUser,
    @Headers('idempotency-key') key: string,
  ) {
    return this.commercial.publish(customerId, contractId, body, actor.id, key);
  }
  @Post(':revisionId/sync')
  sync(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
    @Param('revisionId', new ParseUUIDPipe()) revisionId: string,
  ) {
    return this.commercial.sync(customerId, contractId, revisionId);
  }
}
