import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ControlUser } from '../../domain/entities/control-user';
import { ControlUserRepository } from '../../domain/ports/control-user.repository';
import { ControlUserOrmEntity } from './entities/control-user.orm-entity';
import { ControlUserMapper } from './control-user.mapper';

@Injectable()
export class TypeormControlUserRepository implements ControlUserRepository {
  constructor(
    @InjectRepository(ControlUserOrmEntity)
    private readonly repository: Repository<ControlUserOrmEntity>,
  ) {}

  count(): Promise<number> {
    return this.repository.count();
  }

  async findByEmail(email: string): Promise<ControlUser | null> {
    const entity = await this.repository.findOne({ where: { email } });
    return entity ? ControlUserMapper.toDomain(entity) : null;
  }

  async findById(id: string): Promise<ControlUser | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? ControlUserMapper.toDomain(entity) : null;
  }

  async createAdmin(input: {
    email: string;
    name: string;
    passwordHash: string | null;
    mustChangePassword: boolean;
    firstAccessTokenHash: string;
  }): Promise<ControlUser> {
    const entity = this.repository.create({
      email: input.email.toLowerCase(),
      name: input.name,
      passwordHash: input.passwordHash,
      role: 'admin',
      mustChangePassword: input.mustChangePassword,
      firstAccessTokenHash: input.firstAccessTokenHash,
      isActive: true,
    });

    return ControlUserMapper.toDomain(await this.repository.save(entity));
  }

  async updatePassword(input: {
    userId: string;
    passwordHash: string;
    mustChangePassword: boolean;
    firstAccessTokenHash?: string | null;
  }): Promise<void> {
    await this.repository.update(
      { id: input.userId },
      {
        passwordHash: input.passwordHash,
        mustChangePassword: input.mustChangePassword,
        ...(input.firstAccessTokenHash !== undefined
          ? { firstAccessTokenHash: input.firstAccessTokenHash }
          : {}),
      },
    );
  }

  async updateFirstAccessToken(input: {
    userId: string;
    firstAccessTokenHash: string;
  }): Promise<void> {
    await this.repository.update(
      { id: input.userId },
      { firstAccessTokenHash: input.firstAccessTokenHash },
    );
  }
}
