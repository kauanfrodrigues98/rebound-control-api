import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSuspensionBillingPolicy1791388800000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(
      "ALTER TABLE control.contract_billing_enrollments ADD COLUMN suspension_billing_policy text NOT NULL DEFAULT 'pause' CHECK(suspension_billing_policy IN ('pause','continue'))",
    );
  }
  async down(q: QueryRunner) {
    await q.query(
      'ALTER TABLE control.contract_billing_enrollments DROP COLUMN suspension_billing_policy',
    );
  }
}
