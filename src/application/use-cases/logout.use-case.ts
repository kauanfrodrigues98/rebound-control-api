import { Inject, Injectable } from '@nestjs/common';
import { SESSION_STORE } from '../../domain/ports/session-store';
import type { SessionStore } from '../../domain/ports/session-store';
import { TOKEN_SERVICE } from '../../domain/ports/token-service';
import type { TokenService } from '../../domain/ports/token-service';

@Injectable()
export class LogoutUseCase {
  constructor(
    @Inject(SESSION_STORE)
    private readonly sessionStore: SessionStore,
    @Inject(TOKEN_SERVICE)
    private readonly tokenService: TokenService,
  ) {}

  async execute(refreshToken: string | null): Promise<void> {
    if (!refreshToken) return;

    try {
      const payload = await this.tokenService.verifyRefreshToken(refreshToken);
      if (payload.sid) await this.sessionStore.deleteRefreshSession(payload.sid);
    } catch {
      return;
    }
  }
}
