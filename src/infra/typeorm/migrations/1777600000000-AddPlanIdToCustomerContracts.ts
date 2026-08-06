import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlanIdToCustomerContracts1777600000000
  implements MigrationInterface
{
  name = 'AddPlanIdToCustomerContracts1777600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE control.customer_contracts
      ADD COLUMN IF NOT EXISTS plan_id varchar(80)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE control.customer_contracts
      DROP COLUMN IF EXISTS plan_id
    `);
  }
}
