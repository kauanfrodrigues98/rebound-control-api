import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth.module';
import { LicensingAdminClient } from '../infra/licensing/licensing-admin.client';
import { CustomerContactOrmEntity } from '../infra/typeorm/entities/customer-contact.orm-entity';
import { CustomerContractOrmEntity } from '../infra/typeorm/entities/customer-contract.orm-entity';
import { CustomerTimelineEntryOrmEntity } from '../infra/typeorm/entities/customer-timeline-entry.orm-entity';
import { CustomerOrmEntity } from '../infra/typeorm/entities/customer.orm-entity';
import { CustomersController } from '../presentation/http/customers/customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      CustomerOrmEntity,
      CustomerContactOrmEntity,
      CustomerTimelineEntryOrmEntity,
      CustomerContractOrmEntity,
    ]),
  ],
  controllers: [CustomersController],
  providers: [CustomersService, LicensingAdminClient],
})
export class CustomersModule {}
