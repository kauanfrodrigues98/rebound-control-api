import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CloudBillingGuard } from './cloud-billing.guard';
import { CloudBillingService } from './cloud-billing.service';
import { FinancialHeadersInterceptor } from '../billing/financial-headers.interceptor';
@UseGuards(CloudBillingGuard)
@UseInterceptors(FinancialHeadersInterceptor)
@Controller('internal/cloud-billing')
export class CloudBillingController {
  constructor(private readonly service: CloudBillingService) {}
  @Get('plans') plans() {
    return this.service.plans();
  }
  @Post(':accountUuid/provision') provision(
    @Param('accountUuid', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.provision(id, body);
  }
  @Get(':accountUuid') state(
    @Param('accountUuid', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.state(id);
  }
  @Post(':accountUuid/portal') portal(
    @Param('accountUuid', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.portal(id);
  }
  @Post(':accountUuid/plan') plan(
    @Param('accountUuid', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    return this.service.change(id, body, key);
  }
}
