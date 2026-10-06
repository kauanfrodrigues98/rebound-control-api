import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateFinancialNotices1791302400000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE control.financial_notices(
      id uuid PRIMARY KEY, decision_id uuid NOT NULL UNIQUE REFERENCES control.financial_decisions(id),
      contract_id uuid NOT NULL REFERENCES control.customer_contracts(id), customer_id uuid NOT NULL REFERENCES control.customers(id),
      access_state text NOT NULL CHECK(access_state IN ('healthy','payment_attention','payment_restricted','payment_suspended')),
      status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','superseded','skipped')),
      attempts integer NOT NULL DEFAULT 0, lease_until timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT now(),
      last_error text, sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(
      `CREATE INDEX financial_notices_pending_idx ON control.financial_notices(next_attempt_at) WHERE status='pending'`,
    );
  }
  async down(q: QueryRunner) {
    await q.query('DROP TABLE control.financial_notices');
  }
}
