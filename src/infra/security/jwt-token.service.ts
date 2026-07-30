import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'crypto';
import { env } from '../../config/env';
import { ControlUser } from '../../domain/entities/control-user';
import { AuthTokens, TokenPayload, TokenService } from '../../domain/ports/token-service';

@Injectable()
export class JwtTokenService implements TokenService {
  constructor(private readonly jwtService: JwtService) {}

  async issueTokens(user: ControlUser): Promise<AuthTokens> {
    const sessionId = randomUUID();
    const basePayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { ...basePayload, typ: 'access' satisfies TokenPayload['typ'], sid: sessionId },
        {
          secret: env.JWT_ACCESS_SECRET,
          expiresIn: env.JWT_ACCESS_TTL_SECONDS,
          issuer: env.JWT_ISSUER,
          audience: env.JWT_AUDIENCE,
        },
      ),
      this.jwtService.signAsync(
        { ...basePayload, typ: 'refresh' satisfies TokenPayload['typ'], sid: sessionId },
        {
          secret: env.JWT_REFRESH_SECRET,
          expiresIn: env.JWT_REFRESH_TTL_SECONDS,
          issuer: env.JWT_ISSUER,
          audience: env.JWT_AUDIENCE,
        },
      ),
    ]);

    return {
      accessToken,
      refreshToken,
      accessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
      refreshTtlSeconds: env.JWT_REFRESH_TTL_SECONDS,
      sessionId,
    };
  }

  async verifyAccessToken(token: string): Promise<TokenPayload> {
    return this.verifyToken(token, env.JWT_ACCESS_SECRET, 'access');
  }

  async verifyRefreshToken(token: string): Promise<TokenPayload> {
    return this.verifyToken(token, env.JWT_REFRESH_SECRET, 'refresh');
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async verifyToken(
    token: string,
    secret: string,
    type: TokenPayload['typ'],
  ): Promise<TokenPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<TokenPayload>(token, {
        secret,
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
      });

      if (payload.typ !== type) throw new Error('Invalid token type');
      return payload;
    } catch {
      throw new UnauthorizedException('Sessão inválida.');
    }
  }
}
