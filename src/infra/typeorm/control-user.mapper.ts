import { ControlUser } from '../../domain/entities/control-user';
import { ControlUserOrmEntity } from './entities/control-user.orm-entity';

export class ControlUserMapper {
  static toDomain(entity: ControlUserOrmEntity): ControlUser {
    return new ControlUser(
      entity.id,
      entity.email,
      entity.name,
      entity.passwordHash,
      entity.role,
      entity.mustChangePassword,
      entity.firstAccessTokenHash,
      entity.isActive,
      entity.createdAt,
      entity.updatedAt,
    );
  }
}
