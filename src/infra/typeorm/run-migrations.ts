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
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
    migrations: [path.join(__dirname, 'migrations', '*.js')],
    synchronize: false,
    migrationsRun: false,
  });

  try {
    await dataSource.initialize();
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

async function closeDataSource(dataSource: DataSource) {
  if (!dataSource.isInitialized) return;

  await Promise.race([
    dataSource.destroy(),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

runMigrations();
