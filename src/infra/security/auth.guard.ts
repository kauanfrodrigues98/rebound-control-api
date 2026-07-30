import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { SESSION_STORE } from '../../domain/ports/session-store';
import type { SessionStore } from '../../domain/ports/session-store';
import { AuthCookieService } from './auth-cookie.service';
import { JwtTokenService } from './jwt-token.service';
import { CurrentControlUser } from './current-control-user';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly cookies: AuthCookieService,
    private readonly tokens: JwtTokenService,
    @Inject(SESSION_STORE)
    private readonly sessions: SessionStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: { cookie?: string };
      user?: CurrentControlUser;
    }>();
    const accessToken = this.cookies.getAccessToken(request.headers.cookie);
    if (!accessToken) throw new UnauthorizedException('Autenticação necessária.');

    const payload = await this.tokens.verifyAccessToken(accessToken);
    if (!payload.sid) throw new UnauthorizedException('Sessão inválida.');

    const session = await this.sessions.getRefreshSession(payload.sid);
    if (!session || session.userId !== payload.sub) {
      throw new UnauthorizedException('Sessão encerrada. Entre novamente.');
    }

    request.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
    return true;
  }
}
