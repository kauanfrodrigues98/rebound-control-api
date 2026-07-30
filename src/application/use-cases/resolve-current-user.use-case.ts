import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  CONTROL_USER_REPOSITORY,
} from '../../domain/ports/control-user.repository';
import type { ControlUserRepository } from '../../domain/ports/control-user.repository';

@Injectable()
export class ResolveCurrentUserUseCase {
  constructor(
    @Inject(CONTROL_USER_REPOSITORY)
    private readonly users: ControlUserRepository,
  ) {}

  async execute(userId: string) {
    const user = await this.users.findById(userId);
    if (!user?.isActive) throw new UnauthorizedException('Sessão inválida.');

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
