import { Injectable } from '@nestjs/common';
import { Response } from 'express';
import { env } from '../../config/env';
import { AuthTokens } from '../../domain/ports/token-service';

const ACCESS_COOKIE = 'rebound_control_access';
const REFRESH_COOKIE = 'rebound_control_refresh';

@Injectable()
export class AuthCookieService {
  setAuthCookies(response: Response, tokens: AuthTokens): void {
    response.cookie(ACCESS_COOKIE, tokens.accessToken, this.cookieOptions(tokens.accessTtlSeconds));
    response.cookie(REFRESH_COOKIE, tokens.refreshToken, this.cookieOptions(tokens.refreshTtlSeconds));
  }

  clearAuthCookies(response: Response): void {
    response.clearCookie(ACCESS_COOKIE, this.cookieOptions(0));
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions(0));
  }

  getAccessToken(cookieHeader?: string): string | null {
    return this.getCookie(cookieHeader, ACCESS_COOKIE);
  }

  getRefreshToken(cookieHeader?: string): string | null {
    return this.getCookie(cookieHeader, REFRESH_COOKIE);
  }

  private cookieOptions(maxAgeSeconds: number) {
    return {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'lax' as const,
      path: '/',
      domain: env.COOKIE_DOMAIN || undefined,
      maxAge: maxAgeSeconds > 0 ? maxAgeSeconds * 1000 : undefined,
    };
  }

  private getCookie(cookieHeader: string | undefined, name: string): string | null {
    if (!cookieHeader) return null;
    const cookies = cookieHeader.split(';').map((cookie) => cookie.trim());
    const found = cookies.find((cookie) => cookie.startsWith(`${name}=`));
    return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
  }
}
