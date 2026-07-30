import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { env } from '../../config/env';
import {
  CONTROL_USER_REPOSITORY,
} from '../../domain/ports/control-user.repository';
import type { ControlUserRepository } from '../../domain/ports/control-user.repository';
import { PASSWORD_HASHER } from '../../domain/ports/password-hasher';
import type { PasswordHasher } from '../../domain/ports/password-hasher';

@Injectable()
export class BootstrapAdminUseCase implements OnModuleInit {
  private readonly logger = new Logger(BootstrapAdminUseCase.name);

  constructor(
    @Inject(CONTROL_USER_REPOSITORY)
    private readonly users: ControlUserRepository,
    @Inject(PASSWORD_HASHER)
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async onModuleInit(): Promise<void> {
    const email = env.CONTROL_ADMIN_EMAIL ?? 'admin@rebounddlq.local';
    const firstAccessToken =
      env.CONTROL_ADMIN_SETUP_TOKEN ?? randomBytes(24).toString('base64url');
    const firstAccessTokenHash = await this.passwordHasher.hash(firstAccessToken);

    if ((await this.users.count()) > 0) {
      const admin = await this.users.findByEmail(email);
      if (admin?.mustChangePassword && !admin.firstAccessTokenHash) {
        await this.users.updateFirstAccessToken({
          userId: admin.id,
          firstAccessTokenHash,
        });

        this.logger.warn(
          `Chave de primeiro acesso criada para ${email}: ${firstAccessToken}`,
        );
      }
      return;
    }

    await this.users.createAdmin({
      email,
      name: env.CONTROL_ADMIN_NAME,
      passwordHash: null,
      mustChangePassword: true,
      firstAccessTokenHash,
    });

    this.logger.warn(
      `Usuário administrador inicial criado: ${email}. Chave de primeiro acesso: ${firstAccessToken}`,
    );
  }
}
