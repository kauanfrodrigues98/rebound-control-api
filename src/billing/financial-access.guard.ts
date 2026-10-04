import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { allowedOrigins } from '../config/env';
import type { CurrentControlUser } from '../infra/security/current-control-user';
export function assertFinancialOrigin(
  request: Pick<Request, 'method' | 'headers'>,
) {
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
    (!request.headers.origin ||
      !allowedOrigins.includes(request.headers.origin))
  )
    throw new ForbiddenException(
      'Origem da operação financeira não autorizada.',
    );
}
@Injectable()
export class FinancialOperatorGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: CurrentControlUser }>();
    if (!request.user || !['admin', 'operator'].includes(request.user.role))
      throw new ForbiddenException('Acesso financeiro não autorizado.');
    if (
      !['GET', 'HEAD'].includes(request.method) &&
      request.user.role !== 'admin'
    )
      throw new ForbiddenException(
        'Somente administradores podem alterar dados financeiros.',
      );
    assertFinancialOrigin(request);
    return true;
  }
}
@Injectable()
export class FinancialOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    assertFinancialOrigin(context.switchToHttp().getRequest<Request>());
    return true;
  }
}
