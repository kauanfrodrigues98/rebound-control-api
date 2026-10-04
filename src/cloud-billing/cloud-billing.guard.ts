import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { env } from '../config/env';
@Injectable()
export class CloudBillingGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const key = env.CONTROL_CLOUD_API_KEY;
    if (!key)
      throw new ServiceUnavailableException('Integração cloud desabilitada.');
    const received = ctx.switchToHttp().getRequest<Request>().headers[
      'x-cloud-api-key'
    ];
    if (
      typeof received !== 'string' ||
      Buffer.byteLength(received) !== Buffer.byteLength(key) ||
      !timingSafeEqual(Buffer.from(received), Buffer.from(key))
    )
      throw new UnauthorizedException('Credencial interna inválida.');
    return true;
  }
}
