import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  CONTROL_USER_REPOSITORY,
} from '../../domain/ports/control-user.repository';
import type { ControlUserRepository } from '../../domain/ports/control-user.repository';
import { PASSWORD_HASHER } from '../../domain/ports/password-hasher';
import type { PasswordHasher } from '../../domain/ports/password-hasher';
import { SESSION_STORE } from '../../domain/ports/session-store';
import type { SessionStore } from '../../domain/ports/session-store';
import { TOKEN_SERVICE } from '../../domain/ports/token-service';
import type { TokenService } from '../../domain/ports/token-service';

@Injectable()
export class LoginUseCase {
  constructor(
    @Inject(CONTROL_USER_REPOSITORY)
    private readonly users: ControlUserRepository,
    @Inject(PASSWORD_HASHER)
    private readonly passwordHasher: PasswordHasher,
    @Inject(TOKEN_SERVICE)
    private readonly tokenService: TokenService,
    @Inject(SESSION_STORE)
    private readonly sessionStore: SessionStore,
  ) {}

  async execute(input: { email: string; password: string }) {
    const user = await this.users.findByEmail(input.email.toLowerCase());
    if (!user?.isActive) throw new UnauthorizedException('Credenciais inválidas.');
    if (user.mustChangePassword || !user.passwordHash) {
      throw new UnauthorizedException('Use o primeiro acesso para definir sua senha.');
    }

    const validPassword = await this.passwordHasher.verify(input.password, user.passwordHash);
    if (!validPassword) throw new UnauthorizedException('Credenciais inválidas.');

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
