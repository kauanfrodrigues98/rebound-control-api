import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateContractCommercialRevisions1791072000000 implements MigrationInterface {
  name = 'CreateContractCommercialRevisions1791072000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE control.contract_commercial_revisions (
      id uuid PRIMARY KEY, contract_id uuid NOT NULL REFERENCES control.customer_contracts(id) ON DELETE RESTRICT,
      customer_id uuid NOT NULL REFERENCES control.customers(id) ON DELETE RESTRICT,
      source_version integer NOT NULL CHECK (source_version > 0), payload jsonb NOT NULL,
      request_key text NOT NULL, request_hash text NOT NULL, created_by uuid NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','synced')),
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0), next_attempt_at timestamptz NOT NULL DEFAULT now(),
      lease_until timestamptz, claim_id uuid, billing_version_id uuid, synced_at timestamptz, last_error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(contract_id,source_version), UNIQUE(contract_id,request_key)
    )`);
    await queryRunner.query(
      `CREATE INDEX contract_commercial_revisions_dispatch_idx ON control.contract_commercial_revisions(status,next_attempt_at)`,
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE control.contract_commercial_revisions');
  }
}
