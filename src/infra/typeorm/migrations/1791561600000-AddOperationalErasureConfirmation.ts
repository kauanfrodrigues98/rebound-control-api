import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddOperationalErasureConfirmation1791561600000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'ALTER TABLE control.contract_terminations ADD COLUMN operational_erased_at timestamptz',
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(
      'ALTER TABLE control.contract_terminations DROP COLUMN operational_erased_at',
    );
  }
}
