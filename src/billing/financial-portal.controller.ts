import { FinancialHeadersInterceptor } from './financial-headers.interceptor';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { env } from '../config/env';
import { BillingAdminClient } from './billing-admin.client';
import { FinancialOriginGuard } from './financial-access.guard';
import { documentHeaders, receiptFormat } from './billing-control.controller';
const cookieName = 'rebound_financial_access';
export function financialCookie(request: Pick<Request, 'headers'>) {
  const value = request.headers.cookie
    ?.split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value))
    throw new UnauthorizedException(
      'Abra o link de acesso financeiro recebido.',
    );
  return value;
}
const cookieOptions = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE || env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api',
});
@UseInterceptors(FinancialHeadersInterceptor)
@UseGuards(FinancialOriginGuard)
@Controller('financial-portal')
export class FinancialPortalController {
  constructor(private readonly billing: BillingAdminClient) {}
  @Post('session')
  @HttpCode(200)
  async session(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (
      !body ||
      typeof body !== 'object' ||
      Object.keys(body).length !== 1 ||
      !('token' in body) ||
      typeof body.token !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(body.token)
    )
      throw new BadRequestException('Acesso financeiro inválido.');
    const result = await this.billing.request<{ expiresAt: string }>(
      '/financial/portal/session',
      { method: 'POST', access: body.token },
    );
    const maxAge = new Date(result.expiresAt).getTime() - Date.now();
    if (!Number.isFinite(maxAge) || maxAge <= 0)
      throw new UnauthorizedException('Acesso financeiro expirado.');
    response.cookie(cookieName, body.token, { ...cookieOptions(), maxAge });
    response.setHeader('Cache-Control', 'no-store');
    return result;
  }
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie(cookieName, cookieOptions());
    return { loggedOut: true };
  }
  @Get('session')
  current(@Req() request: Request) {
    return this.billing.request('/financial/portal/session', {
      method: 'POST',
      access: financialCookie(request),
    });
  }
  @Get('card') card(@Req() request: Request) {
    return this.billing.request('/financial/portal/card', {
      access: financialCookie(request),
    });
  }
  @Post('card/setup') setupCard(
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(key))
      throw new BadRequestException('Chave inválida.');
    return this.billing.request('/financial/portal/card/setup', {
      method: 'POST',
      body,
      key,
      access: financialCookie(request),
    });
  }
  @Delete('card') disableCard(@Req() request: Request) {
    return this.billing.request('/financial/portal/card', {
      method: 'DELETE',
      access: financialCookie(request),
    });
  }
  @Get('invoices')
  list(@Req() request: Request, @Query('page') page?: string) {
    const value = Number(page ?? 1);
    if (!Number.isInteger(value) || value < 1 || value > 10000)
      throw new BadRequestException('Página inválida.');
    return this.billing.request(`/financial/portal/invoices?page=${value}`, {
      access: financialCookie(request),
    });
  }
  @Get('invoices/:invoiceId')
  details(
    @Req() request: Request,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
  ) {
    return this.billing.request(`/financial/portal/invoices/${invoiceId}`, {
      access: financialCookie(request),
    });
  }
  @Post('invoices/:invoiceId/checkout')
  checkout(
    @Req() request: Request,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Body() body: unknown,
  ) {
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !key || key.length > 255)
      throw new BadRequestException('Chave de idempotência obrigatória.');
    return this.billing.request(
      `/financial/portal/invoices/${invoiceId}/checkout`,
      { method: 'POST', body, access: financialCookie(request), key },
    );
  }
  @Get('invoices/:invoiceId/payments/:paymentId')
  payment(
    @Req() request: Request,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Param('paymentId', new ParseUUIDPipe()) paymentId: string,
  ) {
    return this.billing.request(
      `/financial/portal/invoices/${invoiceId}/payments/${paymentId}`,
      { access: financialCookie(request) },
    );
  }
  @Get('receipts/:receiptId')
  async receipt(
    @Req() request: Request,
    @Param('receiptId', new ParseUUIDPipe()) receiptId: string,
    @Query('format') format: string,
    @Res() response: Response,
  ) {
    const file = await this.billing.document(
      `/financial/portal/receipts/${receiptId}?format=${receiptFormat(format)}`,
      financialCookie(request),
    );
    documentHeaders(response, file);
    response.send(file.body);
  }
}
