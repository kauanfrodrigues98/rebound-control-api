import { Module } from '@nestjs/common';
import { SESSION_STORE } from '../../domain/ports/session-store';
import { RedisService } from './redis.service';

@Module({
  providers: [
    RedisService,
    {
      provide: SESSION_STORE,
      useExisting: RedisService,
    },
  ],
  exports: [SESSION_STORE, RedisService],
})
export class RedisModule {}
