import { ControlUser } from '../entities/control-user';

export const TOKEN_SERVICE = Symbol('TOKEN_SERVICE');

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  sessionId: string;
}

export interface TokenPayload {
  sub: string;
  email: string;
  role: string;
  sid?: string;
  typ: 'access' | 'refresh';
}

export interface TokenService {
  issueTokens(user: ControlUser): Promise<AuthTokens>;
  verifyAccessToken(token: string): Promise<TokenPayload>;
  verifyRefreshToken(token: string): Promise<TokenPayload>;
  hashToken(token: string): string;
}
