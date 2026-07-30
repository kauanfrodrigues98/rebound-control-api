import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ChangePasswordUseCase } from '../../application/use-cases/change-password.use-case';
import { CompleteFirstAccessUseCase } from '../../application/use-cases/complete-first-access.use-case';
import { LoginUseCase } from '../../application/use-cases/login.use-case';
import { LogoutUseCase } from '../../application/use-cases/logout.use-case';
import { RefreshSessionUseCase } from '../../application/use-cases/refresh-session.use-case';
import { ResolveCurrentUserUseCase } from '../../application/use-cases/resolve-current-user.use-case';
import { AuthCookieService } from '../../infra/security/auth-cookie.service';
import { AuthGuard } from '../../infra/security/auth.guard';
import { CurrentUser } from '../../infra/security/current-user.decorator';
import type { CurrentControlUser } from '../../infra/security/current-control-user';
import { changePasswordSchema, firstAccessSchema, loginSchema } from './auth.contracts';
import type { ChangePasswordBody } from './auth.contracts';
import type { FirstAccessBody } from './auth.contracts';
import type { LoginBody } from './auth.contracts';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly loginUseCase: LoginUseCase,
    private readonly completeFirstAccessUseCase: CompleteFirstAccessUseCase,
    private readonly changePasswordUseCase: ChangePasswordUseCase,
    private readonly logoutUseCase: LogoutUseCase,
    private readonly refreshSessionUseCase: RefreshSessionUseCase,
    private readonly resolveCurrentUserUseCase: ResolveCurrentUserUseCase,
    private readonly authCookieService: AuthCookieService,
  ) {}

  @Post('login')
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginBody,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.loginUseCase.execute(body);
    this.authCookieService.setAuthCookies(response, result.tokens);
    return { user: result.user };
  }

  @Post('first-access')
  async firstAccess(
    @Body(new ZodValidationPipe(firstAccessSchema)) body: FirstAccessBody,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.completeFirstAccessUseCase.execute(body);
    this.authCookieService.setAuthCookies(response, result.tokens);
    return { user: result.user };
  }

  @Post('refresh')
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() _body: unknown,
  ) {
    const refreshToken = this.authCookieService.getRefreshToken(request.headers.cookie);
    if (!refreshToken) {
      this.authCookieService.clearAuthCookies(response);
      return { user: null };
    }

    const result = await this.refreshSessionUseCase.execute(refreshToken);
    this.authCookieService.setAuthCookies(response, result.tokens);
    return { user: result.user };
  }

  @UseGuards(AuthGuard)
  @Get('me')
  me(@CurrentUser() user: CurrentControlUser) {
    return this.resolveCurrentUserUseCase.execute(user.id);
  }

  @UseGuards(AuthGuard)
  @Post('change-password')
  async changePassword(
    @CurrentUser() user: CurrentControlUser,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordBody,
  ) {
    await this.changePasswordUseCase.execute({
      userId: user.id,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });
    return { success: true };
  }

  @Post('logout')
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.logoutUseCase.execute(
      this.authCookieService.getRefreshToken(request.headers.cookie),
    );
    this.authCookieService.clearAuthCookies(response);
    return { success: true };
  }
}
