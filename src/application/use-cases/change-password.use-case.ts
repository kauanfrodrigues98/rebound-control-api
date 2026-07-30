import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  CONTROL_USER_REPOSITORY,
} from '../../domain/ports/control-user.repository';
import type { ControlUserRepository } from '../../domain/ports/control-user.repository';
import { PASSWORD_HASHER } from '../../domain/ports/password-hasher';
import type { PasswordHasher } from '../../domain/ports/password-hasher';

@Injectable()
export class ChangePasswordUseCase {
  constructor(
    @Inject(CONTROL_USER_REPOSITORY)
    private readonly users: ControlUserRepository,
    @Inject(PASSWORD_HASHER)
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async execute(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    const user = await this.users.findById(input.userId);
    if (!user?.isActive) throw new UnauthorizedException('Sessão inválida.');
    if (!user.passwordHash) {
      throw new BadRequestException('Defina sua senha pelo fluxo de primeiro acesso.');
    }

    const validCurrentPassword = await this.passwordHasher.verify(
      input.currentPassword,
      user.passwordHash,
    );
    if (!validCurrentPassword) throw new BadRequestException('Senha atual inválida.');

    const samePassword = await this.passwordHasher.verify(input.newPassword, user.passwordHash);
    if (samePassword) {
      throw new BadRequestException('A nova senha deve ser diferente da senha atual.');
    }

    await this.users.updatePassword({
      userId: user.id,
      passwordHash: await this.passwordHasher.hash(input.newPassword),
      mustChangePassword: false,
    });
  }
}
