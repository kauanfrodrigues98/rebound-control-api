import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateFinancialDecisions1791086400000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(
      `CREATE TABLE control.financial_decisions(id uuid PRIMARY KEY,contract_id uuid NOT NULL REFERENCES control.customer_contracts(id),customer_id uuid NOT NULL REFERENCES control.customers(id),source_version bigint NOT NULL,payload jsonb NOT NULL,request_hash text NOT NULL,status text NOT NULL DEFAULT 'pending',attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),last_error text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(contract_id,source_version))`,
    );
    await q.query(
      `CREATE INDEX financial_decisions_pending_idx ON control.financial_decisions(status,next_attempt_at)`,
    );
  }
  async down(q: QueryRunner) {
    await q.query('DROP TABLE control.financial_decisions');
  }
}
