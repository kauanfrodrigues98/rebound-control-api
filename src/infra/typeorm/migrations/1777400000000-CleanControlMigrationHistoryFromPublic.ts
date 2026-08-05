import { MigrationInterface, QueryRunner } from 'typeorm';

export class CleanControlMigrationHistoryFromPublic1777400000000
  implements MigrationInterface
{
  name = 'CleanControlMigrationHistoryFromPublic1777400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.migrations') IS NOT NULL THEN
          DELETE FROM public.migrations
          WHERE name IN (
            'CreateControlUsers1772000000000',
            'AddFirstAccessToControlUsers1772100000000',
            'MoveControlTablesToControlSchema1777300000000'
          );
        END IF;
      END $$;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.migrations (
        id SERIAL PRIMARY KEY,
        timestamp bigint NOT NULL,
        name varchar NOT NULL
      )
    `);
    await queryRunner.query(`
      INSERT INTO public.migrations (timestamp, name)
      SELECT timestamp, name
      FROM control.migrations cm
      WHERE cm.name IN (
        'CreateControlUsers1772000000000',
        'AddFirstAccessToControlUsers1772100000000',
        'MoveControlTablesToControlSchema1777300000000'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.migrations pm
        WHERE pm.timestamp = cm.timestamp
          AND pm.name = cm.name
      )
    `);
  }
}
