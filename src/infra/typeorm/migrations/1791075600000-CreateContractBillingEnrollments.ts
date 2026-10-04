import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateContractBillingEnrollments1791075600000 implements MigrationInterface {
  name = 'CreateContractBillingEnrollments1791075600000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE control.contract_billing_enrollments (
    id uuid PRIMARY KEY,customer_id uuid NOT NULL REFERENCES control.customers(id) ON DELETE RESTRICT,
    contract_id uuid NOT NULL UNIQUE REFERENCES control.customer_contracts(id) ON DELETE RESTRICT,
    initial_revision_id uuid NOT NULL REFERENCES control.contract_commercial_revisions(id) ON DELETE RESTRICT,
    first_cycle_on date NOT NULL,next_cycle_on date,enabled boolean NOT NULL DEFAULT true,
    billing_schedule_id uuid,last_invoice_id uuid,last_error text,next_attempt_at timestamptz NOT NULL DEFAULT now(),
    request_key text NOT NULL,request_hash text NOT NULL,reason text NOT NULL,created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
    await queryRunner.query(
      `CREATE INDEX contract_billing_enrollments_due_idx ON control.contract_billing_enrollments(enabled,next_cycle_on,next_attempt_at)`,
    );
    await queryRunner.query(`CREATE TABLE control.contract_billing_events (id uuid PRIMARY KEY,enrollment_id uuid NOT NULL REFERENCES control.contract_billing_enrollments(id) ON DELETE RESTRICT,
    action text NOT NULL,actor_id uuid NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE control.contract_billing_events');
    await queryRunner.query('DROP TABLE control.contract_billing_enrollments');
  }
}
