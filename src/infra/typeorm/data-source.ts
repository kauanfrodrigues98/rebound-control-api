import { DataSource } from 'typeorm';
import { env } from '../../config/env';
import { ControlUserOrmEntity } from './entities/control-user.orm-entity';
import { CustomerContactOrmEntity } from './entities/customer-contact.orm-entity';
import { CustomerContractOrmEntity } from './entities/customer-contract.orm-entity';
import { CustomerTimelineEntryOrmEntity } from './entities/customer-timeline-entry.orm-entity';
import { CustomerOrmEntity } from './entities/customer.orm-entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: env.DATABASE_HOST,
  port: env.DATABASE_PORT,
  username: env.DATABASE_USERNAME,
  password: env.DATABASE_PASSWORD,
  database: env.DATABASE_NAME,
  schema: 'control',
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
  entities: [
    ControlUserOrmEntity,
    CustomerOrmEntity,
    CustomerContactOrmEntity,
    CustomerTimelineEntryOrmEntity,
    CustomerContractOrmEntity,
  ],
  migrations: ['dist/infra/typeorm/migrations/*.js'],
  synchronize: false,
});
