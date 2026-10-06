import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateSelfHostedRequests1791104400000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE control.self_hosted_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id uuid NOT NULL REFERENCES control.customers(id),
      account_uuid uuid NOT NULL REFERENCES control.cloud_billing_bindings(account_uuid),
      contact_name varchar(120) NOT NULL, contact_email varchar(320) NOT NULL,
      contact_phone varchar(40) NOT NULL, message text NOT NULL,
      status varchar(24) NOT NULL DEFAULT 'new' CHECK(status IN ('new','in_progress','completed','closed')),
      request_key varchar(80) NOT NULL, request_hash varchar(64) NOT NULL,
      email_state varchar(24) NOT NULL DEFAULT 'pending' CHECK(email_state IN ('pending','sending','sent','failed')),
      email_attempts integer NOT NULL DEFAULT 0, email_error varchar(80),
      email_lease_until timestamptz, email_next_attempt_at timestamptz NOT NULL DEFAULT now(),
      email_sent_at timestamptz, email_recipient varchar(320),
      handled_by uuid REFERENCES control.control_users(id), last_note text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(account_uuid,request_key))`);
    await q.query(
      "CREATE UNIQUE INDEX one_open_self_hosted_request ON control.self_hosted_requests(customer_id) WHERE status IN ('new','in_progress')",
    );
    await q.query(
      'CREATE INDEX self_hosted_request_queue ON control.self_hosted_requests(email_state,email_next_attempt_at)',
    );
  }
  async down(q: QueryRunner) {
    await q.query('DROP TABLE control.self_hosted_requests');
  }
}
