import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateCloudPlanChangeRequests1791111600000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE control.cloud_plan_change_requests(
   id uuid PRIMARY KEY,account_uuid uuid NOT NULL REFERENCES control.cloud_billing_bindings(account_uuid),
   customer_id uuid NOT NULL REFERENCES control.customers(id),contract_id uuid NOT NULL REFERENCES control.customer_contracts(id),
   request_key text NOT NULL,request_hash text NOT NULL,plan_id text NOT NULL,target jsonb NOT NULL,quote jsonb NOT NULL,
   kind text NOT NULL CHECK(kind IN ('free_upgrade','upgrade','downgrade')),
   status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','awaiting_payment','scheduled','activated','completed','needs_review','cancelled')),
   revision_id uuid REFERENCES control.contract_commercial_revisions(id),invoice_id uuid,
   last_error text,lease_until timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT now(),
   created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(account_uuid,request_key))`);
    await q.query(
      `CREATE UNIQUE INDEX cloud_plan_change_open_uq ON control.cloud_plan_change_requests(contract_id) WHERE status IN ('requested','awaiting_payment','scheduled','activated')`,
    );
    await q.query(
      `CREATE INDEX cloud_plan_change_queue_idx ON control.cloud_plan_change_requests(next_attempt_at) WHERE status IN ('requested','awaiting_payment','scheduled','activated')`,
    );
  }
  async down(q: QueryRunner) {
    await q.query('DROP TABLE control.cloud_plan_change_requests');
  }
}
