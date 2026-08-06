import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomerManagementTables1777500000000
  implements MigrationInterface
{
  name = 'CreateCustomerManagementTables1777500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "control"');
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS control.customers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(180) NOT NULL,
        type varchar(32) NOT NULL DEFAULT 'prospect',
        stage varchar(32) NOT NULL DEFAULT 'prospeccao',
        legal_name varchar(220),
        document varchar(80),
        segment varchar(120),
        website varchar(255),
        commercial_owner varchar(160),
        priority varchar(32) NOT NULL DEFAULT 'media',
        expected_value varchar(80),
        expected_environment varchar(32) NOT NULL DEFAULT 'indefinido',
        technical_owner varchar(160),
        notes text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_customers_name ON control.customers (name)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_customers_stage ON control.customers (stage)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS idx_customers_segment ON control.customers (segment)');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS control.customer_contacts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id uuid NOT NULL REFERENCES control.customers(id) ON DELETE CASCADE,
        name varchar(160),
        email varchar(320),
        phone varchar(60),
        role_title varchar(120),
        role varchar(32) NOT NULL DEFAULT 'principal',
        preference varchar(32) NOT NULL DEFAULT 'email',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_customer_contacts_customer_id ON control.customer_contacts (customer_id)',
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS control.customer_timeline_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id uuid NOT NULL REFERENCES control.customers(id) ON DELETE CASCADE,
        type varchar(32) NOT NULL DEFAULT 'observacao',
        title varchar(180) NOT NULL,
        description text,
        scheduled_for date,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_customer_timeline_entries_customer_id ON control.customer_timeline_entries (customer_id)',
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS control.customer_contracts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id uuid NOT NULL REFERENCES control.customers(id) ON DELETE CASCADE,
        code varchar(32) NOT NULL UNIQUE,
        plan varchar(160) NOT NULL,
        plan_id varchar(80),
        status varchar(32) NOT NULL DEFAULT 'rascunho',
        cycle varchar(32) NOT NULL DEFAULT 'mensal',
        monthly_value varchar(80),
        setup_value varchar(80),
        starts_on date,
        ends_on date,
        due_day varchar(2),
        payment_method varchar(120),
        signing_contact varchar(160),
        notes text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_customer_contracts_customer_id ON control.customer_contracts (customer_id)',
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS control.contract_code_counters (
        year integer PRIMARY KEY,
        last_value integer NOT NULL DEFAULT 0
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS control.contract_code_counters');
    await queryRunner.query('DROP TABLE IF EXISTS control.customer_contracts');
    await queryRunner.query('DROP TABLE IF EXISTS control.customer_timeline_entries');
    await queryRunner.query('DROP TABLE IF EXISTS control.customer_contacts');
    await queryRunner.query('DROP TABLE IF EXISTS control.customers');
  }
}
