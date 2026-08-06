import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth.module';
import { env } from './config/env';
import { DatabaseModule } from './infra/typeorm/database.module';
import { LicensingControlModule } from './licensing-control.module';
import { CustomersModule } from './customers/customers.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: env.NODE_ENV === 'production' ? 60 : 300,
      },
    ]),
    DatabaseModule,
    AuthModule,
    LicensingControlModule,
    CustomersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
