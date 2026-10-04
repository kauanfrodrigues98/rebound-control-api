import { FinancialHeadersInterceptor } from './financial-headers.interceptor';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../infra/security/auth.guard';
import { CurrentUser } from '../infra/security/current-user.decorator';
import type { CurrentControlUser } from '../infra/security/current-control-user';
import { BillingAdminClient } from './billing-admin.client';
import { FinancialOperatorGuard } from './financial-access.guard';
import { BadRequestException } from '@nestjs/common';

function key(value: string) {
  if (!value || value.length > 255 || !/^[\x21-\x7e]+$/.test(value))
    throw new BadRequestException('Chave de idempotência obrigatória.');
  return value;
}
function page(value?: string) {
  const result = Number(value ?? '1');
  if (!Number.isInteger(result) || result < 1 || result > 10000)
    throw new BadRequestException('Página inválida.');
  return result;
}
export function receiptFormat(value?: string) {
  if (value && !['html', 'pdf'].includes(value))
    throw new BadRequestException('Formato inválido.');
  return value ?? 'pdf';
}
export function documentHeaders(
  response: Response,
  file: { type: string; disposition: string },
) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
  response.setHeader('Content-Type', file.type);
  response.setHeader('Content-Disposition', file.disposition);
}
@UseInterceptors(FinancialHeadersInterceptor)
@UseGuards(AuthGuard, FinancialOperatorGuard)
@Controller('billing/customers/:customerId')
export class BillingControlController {
  constructor(private readonly billing: BillingAdminClient) {}
  @Get()
  overview(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Query('page') value?: string,
  ) {
    return this.billing.request(
      `/financial/customers/${customerId}?page=${page(value)}`,
    );
  }
  @Put('profile')
  profile(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Body() body: unknown,
    @CurrentUser() actor: CurrentControlUser,
  ) {
    return this.billing.request(`/financial/customers/${customerId}/profile`, {
      method: 'PUT',
      body,
      actorId: actor.id,
    });
  }
  @Post('access')
  grant(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Body() body: unknown,
    @CurrentUser() actor: CurrentControlUser,
  ) {
    return this.billing.request(`/financial/customers/${customerId}/access`, {
      method: 'POST',
      body,
      actorId: actor.id,
    });
  }
  @Delete('access/:grantId')
  revoke(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('grantId', new ParseUUIDPipe()) grantId: string,
    @CurrentUser() actor: CurrentControlUser,
  ) {
    return this.billing.request(
      `/financial/customers/${customerId}/access/${grantId}`,
      { method: 'DELETE', actorId: actor.id },
    );
  }
  @Get('invoices/:invoiceId')
  details(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
  ) {
    return this.billing.request(
      `/financial/customers/${customerId}/invoices/${invoiceId}`,
    );
  }
  @Post('invoices/:invoiceId/external-receipts')
  async receive(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotency: string,
    @CurrentUser() actor: CurrentControlUser,
  ) {
    await this.details(customerId, invoiceId);
    return this.billing.request(`/invoices/${invoiceId}/external-receipts`, {
      method: 'POST',
      body,
      actorId: actor.id,
      key: key(idempotency),
    });
  }
  @Post('external-receipts/:receiptId/reverse')
  async reverse(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('receiptId', new ParseUUIDPipe()) receiptId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotency: string,
    @CurrentUser() actor: CurrentControlUser,
  ) {
    await this.billing.request(
      `/financial/customers/${customerId}/receipts/${receiptId}/details`,
    );
    return this.billing.request(
      `/invoices/external-receipts/${receiptId}/reverse`,
      { method: 'POST', body, actorId: actor.id, key: key(idempotency) },
    );
  }
  @Post('invoices/:invoiceId/fiscal-documents')
  async fiscal(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotency: string,
    @CurrentUser() actor: CurrentControlUser,
  ) {
    await this.details(customerId, invoiceId);
    return this.billing.request(`/invoices/${invoiceId}/fiscal-documents`, {
      method: 'POST',
      body,
      actorId: actor.id,
      key: key(idempotency),
    });
  }
  @Get('receipts/:receiptId')
  async receipt(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('receiptId', new ParseUUIDPipe()) receiptId: string,
    @Query('format') format: string,
    @Res() response: Response,
  ) {
    const file = await this.billing.document(
      `/financial/customers/${customerId}/receipts/${receiptId}?format=${receiptFormat(format)}`,
    );
    documentHeaders(response, file);
    response.send(file.body);
  }
  @Post('notifications/:id/retry')
  retry(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.billing.request(
      `/financial/customers/${customerId}/notifications/${id}/retry`,
      { method: 'POST' },
    );
  }
}
