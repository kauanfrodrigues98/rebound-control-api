import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
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
export class CompleteFirstAccessUseCase {
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

  async execute(input: { email: string; setupToken: string; newPassword: string }) {
    const user = await this.users.findByEmail(input.email.toLowerCase());
    if (!user?.isActive || !user.mustChangePassword || !user.firstAccessTokenHash) {
      throw new UnauthorizedException('Primeiro acesso indisponível para este usuário.');
    }

    const validSetupToken = await this.passwordHasher.verify(
      input.setupToken,
      user.firstAccessTokenHash,
    );
    if (!validSetupToken) {
      throw new UnauthorizedException('Chave de primeiro acesso inválida.');
    }

    if (user.passwordHash) {
      const samePassword = await this.passwordHasher.verify(input.newPassword, user.passwordHash);
      if (samePassword) {
        throw new BadRequestException('A nova senha deve ser diferente da senha anterior.');
      }
    }

    await this.users.updatePassword({
      userId: user.id,
      passwordHash: await this.passwordHasher.hash(input.newPassword),
      mustChangePassword: false,
      firstAccessTokenHash: null,
    });

    const updatedUser = await this.users.findById(user.id);
    if (!updatedUser) throw new UnauthorizedException('Sessão inválida.');

    const tokens = await this.tokenService.issueTokens(updatedUser);

    await this.sessionStore.saveRefreshSession({
      sessionId: tokens.sessionId,
      userId: updatedUser.id,
      tokenHash: this.tokenService.hashToken(tokens.refreshToken),
      ttlSeconds: tokens.refreshTtlSeconds,
    });

    return {
      tokens,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
        mustChangePassword: updatedUser.mustChangePassword,
      },
    };
  }
}
