import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { CONTROL_USER_REPOSITORY } from '../../domain/ports/control-user.repository';
import type { ControlUserRepository } from '../../domain/ports/control-user.repository';
import { SESSION_STORE } from '../../domain/ports/session-store';
import type { SessionStore } from '../../domain/ports/session-store';
import { TOKEN_SERVICE } from '../../domain/ports/token-service';
import type { TokenService } from '../../domain/ports/token-service';

@Injectable()
export class RefreshSessionUseCase {
  constructor(
    @Inject(CONTROL_USER_REPOSITORY)
    private readonly users: ControlUserRepository,
    @Inject(TOKEN_SERVICE)
    private readonly tokenService: TokenService,
    @Inject(SESSION_STORE)
    private readonly sessionStore: SessionStore,
  ) {}

  async execute(refreshToken: string) {
    const payload = await this.tokenService.verifyRefreshToken(refreshToken);
    if (!payload.sid) throw new UnauthorizedException('Sessão inválida.');

    const storedSession = await this.sessionStore.getRefreshSession(payload.sid);
    const tokenHash = this.tokenService.hashToken(refreshToken);
    if (!storedSession || storedSession.tokenHash !== tokenHash) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const user = await this.users.findById(storedSession.userId);
    if (!user?.isActive) throw new UnauthorizedException('Sessão inválida.');

    await this.sessionStore.deleteRefreshSession(payload.sid);
    const tokens = await this.tokenService.issueTokens(user);
    await this.sessionStore.saveRefreshSession({
      sessionId: tokens.sessionId,
      userId: user.id,
      tokenHash: this.tokenService.hashToken(tokens.refreshToken),
      ttlSeconds: tokens.refreshTtlSeconds,
    });

    return {
      tokens,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
    };
  }
}
