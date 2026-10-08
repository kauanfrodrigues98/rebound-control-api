import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Query,
  ParseUUIDPipe,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CloudBillingGuard } from './cloud-billing.guard';
import { RequestService } from '../requests/request.service';
import { CloudBillingService } from './cloud-billing.service';
import { FinancialHeadersInterceptor } from '../billing/financial-headers.interceptor';
@UseGuards(CloudBillingGuard)
@UseInterceptors(FinancialHeadersInterceptor)
@Controller('internal/cloud-billing')
export class CloudBillingController {
  constructor(
    private readonly service: CloudBillingService,
    private readonly requests: RequestService,
  ) {}
  @Get(':accountUuid/self-hosted-request') async requestState(
    @Param('accountUuid', new ParseUUIDPipe()) id: string,
  ) {
    return { request: await this.requests.latest(id) };
  }
  @Post(':accountUuid/self-hosted-request') request(
    @Param('accountUuid', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    return this.requests.submit(id, body, key);
  }
  @Post(':accountUuid/renewal') renew(
    @Param('accountUuid', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.renew(id, body);
  }
  @Post(':accountUuid/termination') terminate(
    @Param('accountUuid', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    return this.service.terminate(id, body, key);
  }
  @Post(':accountUuid/data-erasure') confirmDataErasure(
    @Param('accountUuid', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.confirmDataErasure(id, body);
  }
  @Get('data-erasure-ledger') ledger(@Query('after') after?: string) {
    return this.service.erasureLedger(after);
  }
  @Get('plans') plans() {
    return this.service.plans();
  }
  @Post(':accountUuid/provision') provision(
    @Param('accountUuid', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.provision(id, body);
  }
  @Post(':accountUuid/usage') usage(
    @Param('accountUuid', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.usage(id, body);
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
  @Post(':accountUuid/plan-preview') previewPlan(
    @Param('accountUuid', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.previewChange(id, body);
  }
  @Post(':accountUuid/plan-changes/:changeId/cancel') cancelPlan(
    @Param('accountUuid', new ParseUUIDPipe()) id: string,
    @Param('changeId', new ParseUUIDPipe()) change: string,
  ) {
    return this.service.cancelChange(id, change);
  }
  @Post(':accountUuid/plan') plan(
    @Param('accountUuid', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    return this.service.change(id, body, key);
  }
}
