import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateContractTerminations1791216000000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE control.contract_terminations (
      contract_id uuid PRIMARY KEY REFERENCES control.customer_contracts(id),
      id uuid NOT NULL UNIQUE, customer_id uuid NOT NULL REFERENCES control.customers(id),
      actor_id uuid NOT NULL, request_key text NOT NULL, reason text NOT NULL,
      effective_at timestamptz NOT NULL, requested_at timestamptz NOT NULL DEFAULT now(),
      status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed')),
      billing_synced_at timestamptz, licensing_synced_at timestamptz, completed_at timestamptz,
      attempts integer NOT NULL DEFAULT 0, last_error text,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      email_recipient text, email_sent_at timestamptz, email_attempts integer NOT NULL DEFAULT 0,
      email_lease_until timestamptz, email_next_attempt_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query(
      `CREATE INDEX contract_termination_pending_idx ON control.contract_terminations(next_attempt_at) WHERE status='scheduled'`,
    );
  }
  async down(q: QueryRunner) {
    await q.query('DROP TABLE control.contract_terminations');
  }
}
