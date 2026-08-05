import { DataSource } from 'typeorm';
import * as path from 'path';
import { env } from '../../config/env';

async function runMigrations() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    username: env.DATABASE_USERNAME,
    password: env.DATABASE_PASSWORD,
    database: env.DATABASE_NAME,
    schema: 'control',
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
    migrations: [path.join(__dirname, 'migrations', '*.js')],
    synchronize: false,
    migrationsRun: false,
  });

  try {
    await dataSource.initialize();
    await bootstrapControlMigrationHistory(dataSource);
    console.log('Database connected. Running pending migrations...');

    const migrations = await dataSource.runMigrations();

    if (migrations.length === 0) {
      console.log('No pending migrations.');
    } else {
      console.log(`Ran ${migrations.length} migration(s):`);
      migrations.forEach((migration) => console.log(`   - ${migration.name}`));
    }

    await closeDataSource(dataSource);
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    await closeDataSource(dataSource);
    process.exit(1);
  }
}

async function bootstrapControlMigrationHistory(dataSource: DataSource) {
  await dataSource.query('CREATE SCHEMA IF NOT EXISTS "control"');
  await dataSource.query(`
    CREATE TABLE IF NOT EXISTS control.migrations (
      id SERIAL PRIMARY KEY,
      timestamp bigint NOT NULL,
      name varchar NOT NULL
    )
  `);
  const [{ legacy_migrations_table: legacyMigrationsTable }] =
    await dataSource.query(`
      SELECT to_regclass('public.migrations') AS legacy_migrations_table
    `);

  if (!legacyMigrationsTable) return;

  await dataSource.query(`
    INSERT INTO control.migrations (timestamp, name)
    SELECT m.timestamp, m.name
    FROM public.migrations m
    WHERE m.name IN (
      'CreateControlUsers1772000000000',
      'AddFirstAccessToControlUsers1772100000000',
      'MoveControlTablesToControlSchema1777300000000'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM control.migrations cm
      WHERE cm.timestamp = m.timestamp
        AND cm.name = m.name
    )
  `);
}

async function closeDataSource(dataSource: DataSource) {
  if (!dataSource.isInitialized) return;

  await Promise.race([
    dataSource.destroy(),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

runMigrations();
