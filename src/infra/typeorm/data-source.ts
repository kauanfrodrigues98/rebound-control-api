import { DataSource } from 'typeorm';
import { env } from '../../config/env';
import { ControlUserOrmEntity } from './entities/control-user.orm-entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: env.DATABASE_HOST,
  port: env.DATABASE_PORT,
  username: env.DATABASE_USERNAME,
  password: env.DATABASE_PASSWORD,
  database: env.DATABASE_NAME,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
  entities: [ControlUserOrmEntity],
  migrations: ['dist/infra/typeorm/migrations/*.js'],
  synchronize: false,
});
