import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFirstAccessToControlUsers1772100000000 implements MigrationInterface {
  name = 'AddFirstAccessToControlUsers1772100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "control_users"
        ALTER COLUMN "password_hash" DROP NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "control_users"
        ADD COLUMN IF NOT EXISTS "first_access_token_hash" varchar(255)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "control_users"
      SET "password_hash" = ''
      WHERE "password_hash" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "control_users"
        ALTER COLUMN "password_hash" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "control_users"
        DROP COLUMN IF EXISTS "first_access_token_hash"
    `);
  }
}
