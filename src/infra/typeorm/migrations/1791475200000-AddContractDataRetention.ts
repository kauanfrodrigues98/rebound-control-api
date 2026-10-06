import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddContractDataRetention1791475200000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(
      'ALTER TABLE control.contract_terminations ADD COLUMN operational_retention_days integer NOT NULL DEFAULT 30 CHECK(operational_retention_days=30), ADD COLUMN operational_retention_until timestamptz',
    );
    await q.query(
      "UPDATE control.contract_terminations SET operational_retention_until=effective_at + interval '30 days'",
    );
    await q.query(
      'ALTER TABLE control.contract_terminations ALTER COLUMN operational_retention_until SET NOT NULL, ADD CONSTRAINT operational_retention_cutoff_ck CHECK(operational_retention_until>=effective_at)',
    );
  }
  async down(q: QueryRunner) {
    await q.query(
      'ALTER TABLE control.contract_terminations DROP COLUMN operational_retention_until, DROP COLUMN operational_retention_days',
    );
  }
}
