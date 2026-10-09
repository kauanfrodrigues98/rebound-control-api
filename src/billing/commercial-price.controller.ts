import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '../infra/security/auth.guard';
import { CurrentUser } from '../infra/security/current-user.decorator';
import type { CurrentControlUser } from '../infra/security/current-control-user';
import { LicensingAdminClient } from '../infra/licensing/licensing-admin.client';
import { BillingAdminClient } from './billing-admin.client';
import { FinancialOperatorGuard } from './financial-access.guard';
import { FinancialHeadersInterceptor } from './financial-headers.interceptor';
@UseInterceptors(FinancialHeadersInterceptor)
@UseGuards(AuthGuard, FinancialOperatorGuard)
@Controller('billing/plans/:planId/prices')
export class CommercialPriceController {
  constructor(
    private readonly billing: BillingAdminClient,
    private readonly licensing: LicensingAdminClient,
  ) {}
  private async plan(planId: string, requireActive = false) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(planId))
      throw new BadRequestException('Plano inválido.');
    const catalog = await this.licensing.request<{
      plans: Array<{ id: string; active: boolean }>;
    }>('/admin/licenses/plans?includeArchived=true');
    const plan = catalog.plans.find((item) => item.id === planId);
    if (!plan)
      throw new NotFoundException('Plano não encontrado no Licensing.');
    if (requireActive && !plan.active)
      throw new ConflictException('Plano arquivado não aceita novos preços.');
  }
  @Get()
  async list(
    @Param('planId') planId: string,
    @Query('page') page?: string,
    @Query('currency') currency = 'BRL',
  ) {
    await this.plan(planId);
    if (!['BRL', 'USD'].includes(currency))
      throw new BadRequestException('Moeda inválida.');
    const value = Number(page ?? 1);
    if (!Number.isInteger(value) || value < 1 || value > 10000)
      throw new BadRequestException('Página inválida.');
    return this.billing.request(
      `/commercial/plans/${encodeURIComponent(planId)}/prices?page=${value}&currency=${currency}`,
    );
  }
  @Post()
  async publish(
    @Param('planId') planId: string,
    @Body() body: unknown,
    @CurrentUser() actor: CurrentControlUser,
    @Headers('idempotency-key') key: string,
  ) {
    await this.plan(planId, true);
    return this.billing.request(
      `/commercial/plans/${encodeURIComponent(planId)}/prices`,
      { method: 'POST', body, actorId: actor.id, key },
    );
  }
}
