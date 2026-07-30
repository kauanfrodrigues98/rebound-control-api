import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BootstrapAdminUseCase } from './application/use-cases/bootstrap-admin.use-case';
import { ChangePasswordUseCase } from './application/use-cases/change-password.use-case';
import { CompleteFirstAccessUseCase } from './application/use-cases/complete-first-access.use-case';
import { LoginUseCase } from './application/use-cases/login.use-case';
import { LogoutUseCase } from './application/use-cases/logout.use-case';
import { RefreshSessionUseCase } from './application/use-cases/refresh-session.use-case';
import { ResolveCurrentUserUseCase } from './application/use-cases/resolve-current-user.use-case';
import { CONTROL_USER_REPOSITORY } from './domain/ports/control-user.repository';
import { PASSWORD_HASHER } from './domain/ports/password-hasher';
import { TOKEN_SERVICE } from './domain/ports/token-service';
import { RedisModule } from './infra/redis/redis.module';
import { AuthCookieService } from './infra/security/auth-cookie.service';
import { AuthGuard } from './infra/security/auth.guard';
import { BcryptPasswordHasher } from './infra/security/bcrypt-password-hasher';
import { JwtTokenService } from './infra/security/jwt-token.service';
import { ControlUserOrmEntity } from './infra/typeorm/entities/control-user.orm-entity';
import { TypeormControlUserRepository } from './infra/typeorm/typeorm-control-user.repository';
import { AuthController } from './presentation/http/auth.controller';

@Module({
  imports: [JwtModule.register({ global: true }), TypeOrmModule.forFeature([ControlUserOrmEntity]), RedisModule],
  controllers: [AuthController],
  providers: [
    BootstrapAdminUseCase,
    ChangePasswordUseCase,
    CompleteFirstAccessUseCase,
    LoginUseCase,
    LogoutUseCase,
    RefreshSessionUseCase,
    ResolveCurrentUserUseCase,
    AuthCookieService,
    AuthGuard,
    BcryptPasswordHasher,
    JwtTokenService,
    {
      provide: CONTROL_USER_REPOSITORY,
      useClass: TypeormControlUserRepository,
    },
    {
      provide: PASSWORD_HASHER,
      useExisting: BcryptPasswordHasher,
    },
    {
      provide: TOKEN_SERVICE,
      useExisting: JwtTokenService,
    },
  ],
  exports: [AuthGuard, AuthCookieService, JwtTokenService, RedisModule],
})
export class AuthModule {}
