import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../infra/security/auth.guard';
import type { CurrentControlUser } from '../infra/security/current-control-user';
import { FinancialOperatorGuard } from '../billing/financial-access.guard';
import { RequestService } from './request.service';
import { RequestRepository } from './request.repository';
@UseGuards(AuthGuard, FinancialOperatorGuard)
@Controller('requests/self-hosted')
export class RequestController {
  constructor(
    private readonly service: RequestService,
    private readonly repository: RequestRepository,
  ) {}
  @Get() list(@Query('status') status?: string, @Query('page') page?: string) {
    return this.service.list(status, page);
  }
  @Put(':id') update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: Request & { user: CurrentControlUser },
  ) {
    return this.service.update(id, body, req.user.id);
  }
  @Post(':id/retry-email') retry(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.repository.retry(id);
  }
}
