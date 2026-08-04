import { MigrationInterface, QueryRunner } from 'typeorm';

export class MoveControlTablesToControlSchema1777300000000
  implements MigrationInterface
{
  name = 'MoveControlTablesToControlSchema1777300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "control"');
    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.control_users') IS NOT NULL
          AND to_regclass('control.control_users') IS NULL THEN
          ALTER TABLE public.control_users SET SCHEMA control;
        END IF;
      END $$;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('control.control_users') IS NOT NULL
          AND to_regclass('public.control_users') IS NULL THEN
          ALTER TABLE control.control_users SET SCHEMA public;
        END IF;
      END $$;
    `);
    await queryRunner.query('DROP SCHEMA IF EXISTS "control"');
  }
}
