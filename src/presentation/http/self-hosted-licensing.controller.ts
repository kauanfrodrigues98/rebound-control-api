import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { LicensingAdminClient } from '../../infra/licensing/licensing-admin.client';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';

const checkInLicenseSchema = z.object({
  licenseToken: z.string().min(32).max(128),
  installationFingerprint: z.string().min(16).max(255),
  currentLicenseVersion: z.number().int().nonnegative().optional(),
  appVersion: z.string().min(1).max(64),
  usage: z.object({
    projects: z.number().int().nonnegative(),
    users: z.number().int().nonnegative(),
    monthlyEvents: z.number().int().nonnegative(),
  }),
});

const licenseInstanceParamsSchema = z.object({
  licenseInstanceId: z.string().min(1).max(80),
});

type CheckInLicenseBody = z.infer<typeof checkInLicenseSchema>;
type LicenseInstanceParams = z.infer<typeof licenseInstanceParamsSchema>;

@Controller('self-hosted/licenses')
export class SelfHostedLicensingController {
  constructor(private readonly licensing: LicensingAdminClient) {}

  @Post('check-in')
  checkIn(@Body(new ZodValidationPipe(checkInLicenseSchema)) body: CheckInLicenseBody) {
    return this.licensing.publicRequest('/licenses/check-in', {
      method: 'POST',
      body,
    });
  }

  @Get(':licenseInstanceId/current')
  current(
    @Param(new ZodValidationPipe(licenseInstanceParamsSchema))
    params: LicenseInstanceParams,
  ) {
    return this.licensing.publicRequest(
      `/licenses/${encodeURIComponent(params.licenseInstanceId)}/current`,
    );
  }
}
