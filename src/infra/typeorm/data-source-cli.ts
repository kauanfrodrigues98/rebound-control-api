import { DataSource } from 'typeorm';
import { env } from '../../config/env';

export default new DataSource({
  type: 'postgres',
  host: env.DATABASE_HOST,
  port: env.DATABASE_PORT,
  username: env.DATABASE_USERNAME,
  password: env.DATABASE_PASSWORD,
  database: env.DATABASE_NAME,
  schema: 'control',
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
  entities: ['src/infra/typeorm/entities/*.orm-entity.ts'],
  migrations: ['src/infra/typeorm/migrations/*.ts'],
  synchronize: false,
});
