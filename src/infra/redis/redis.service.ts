import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../../config/env';
import { SessionStore } from '../../domain/ports/session-store';

@Injectable()
export class RedisService implements OnModuleDestroy, SessionStore {
  private readonly client = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB,
    lazyConnect: true,
    maxRetriesPerRequest: 2,
  });

  async saveRefreshSession(input: {
    sessionId: string;
    userId: string;
    tokenHash: string;
    ttlSeconds: number;
  }): Promise<void> {
    await this.client.set(
      this.sessionKey(input.sessionId),
      JSON.stringify({ userId: input.userId, tokenHash: input.tokenHash }),
      'EX',
      input.ttlSeconds,
    );
  }

  async getRefreshSession(sessionId: string): Promise<{ userId: string; tokenHash: string } | null> {
    const value = await this.client.get(this.sessionKey(sessionId));
    return value ? (JSON.parse(value) as { userId: string; tokenHash: string }) : null;
  }

  async deleteRefreshSession(sessionId: string): Promise<void> {
    await this.client.del(this.sessionKey(sessionId));
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  private sessionKey(sessionId: string): string {
    return `rebound-control:session:${sessionId}`;
  }
}
