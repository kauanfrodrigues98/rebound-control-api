import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateCloudBillingBindings1791090000000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(
      `CREATE TABLE control.cloud_billing_bindings(account_uuid uuid PRIMARY KEY,customer_id uuid NOT NULL UNIQUE REFERENCES control.customers(id),contract_id uuid NOT NULL UNIQUE REFERENCES control.customer_contracts(id),onboarding jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`,
    );
    await q.query(
      `CREATE TABLE control.cloud_plan_changes(account_uuid uuid NOT NULL REFERENCES control.cloud_billing_bindings(account_uuid),request_key text NOT NULL,plan_id text NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(account_uuid,request_key))`,
    );
  }
  async down(q: QueryRunner) {
    await q.query('DROP TABLE control.cloud_plan_changes');
    await q.query('DROP TABLE control.cloud_billing_bindings');
  }
}
