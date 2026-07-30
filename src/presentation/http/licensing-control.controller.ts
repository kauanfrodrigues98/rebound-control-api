import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { LicensingAdminClient } from '../../infra/licensing/licensing-admin.client';
import { AuthGuard } from '../../infra/security/auth.guard';

@UseGuards(AuthGuard)
@Controller()
export class LicensingControlController {
  constructor(private readonly licensing: LicensingAdminClient) {}

  @Get('licenses')
  listLicenses() {
    return this.licensing.request('/admin/licenses');
  }

  @Post('licenses')
  activateLicense(@Body() body: unknown) {
    return this.licensing.request('/admin/licenses/activate', {
      method: 'POST',
      body,
    });
  }

  @Get('licenses/:licenseInstanceId/current')
  getCurrentLicense(@Param('licenseInstanceId') licenseInstanceId: string) {
    return this.licensing.request(
      `/licenses/${encodeURIComponent(licenseInstanceId)}/current`,
    );
  }

  @Post('licenses/:licenseInstanceId/reissue')
  reissueLicense(
    @Param('licenseInstanceId') licenseInstanceId: string,
    @Body() body: unknown,
  ) {
    return this.licensing.request(
      `/admin/licenses/${encodeURIComponent(licenseInstanceId)}/reissue`,
      {
        method: 'POST',
        body,
      },
    );
  }

  @Get('plans')
  listPlans(@Query('includeArchived') includeArchived?: string) {
    const suffix = includeArchived === 'true' ? '?includeArchived=true' : '';
    return this.licensing.request(`/admin/licenses/plans${suffix}`);
  }

  @Post('plans')
  createPlan(@Body() body: unknown) {
    return this.licensing.request('/admin/licenses/plans', {
      method: 'POST',
      body,
    });
  }

  @Put('plans/:planId')
  updatePlan(@Param('planId') planId: string, @Body() body: unknown) {
    return this.licensing.request(
      `/admin/licenses/plans/${encodeURIComponent(planId)}`,
      {
        method: 'PUT',
        body,
      },
    );
  }

  @Delete('plans/:planId')
  archivePlan(@Param('planId') planId: string) {
    return this.licensing.request(
      `/admin/licenses/plans/${encodeURIComponent(planId)}`,
      {
        method: 'DELETE',
      },
    );
  }
}
