import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateCommercialCancellations1791093600000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(
      'ALTER TABLE control.contract_commercial_revisions ADD COLUMN cancelled_at timestamptz',
    );
    await q.query(
      `CREATE TABLE control.commercial_cancellations(revision_id uuid PRIMARY KEY REFERENCES control.contract_commercial_revisions(id),contract_id uuid NOT NULL REFERENCES control.customer_contracts(id),payload jsonb NOT NULL,actor_id uuid NOT NULL,status text NOT NULL DEFAULT 'pending',next_attempt_at timestamptz NOT NULL DEFAULT now())`,
    );
  }
  async down(q: QueryRunner) {
    await q.query('DROP TABLE control.commercial_cancellations');
    await q.query(
      'ALTER TABLE control.contract_commercial_revisions DROP COLUMN cancelled_at',
    );
  }
}
