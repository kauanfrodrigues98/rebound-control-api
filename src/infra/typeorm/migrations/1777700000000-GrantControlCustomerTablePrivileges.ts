import { MigrationInterface, QueryRunner } from 'typeorm';

export class GrantControlCustomerTablePrivileges1777700000000
  implements MigrationInterface
{
  name = 'GrantControlCustomerTablePrivileges1777700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      GRANT USAGE, CREATE ON SCHEMA control TO rebound_control_app_usr
    `);
    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE
      ON ALL TABLES IN SCHEMA control
      TO rebound_control_app_usr
    `);
    await queryRunner.query(`
      GRANT USAGE, SELECT, UPDATE
      ON ALL SEQUENCES IN SCHEMA control
      TO rebound_control_app_usr
    `);
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA control
      GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLES TO rebound_control_app_usr
    `);
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA control
      GRANT USAGE, SELECT, UPDATE
      ON SEQUENCES TO rebound_control_app_usr
    `);
  }

  async down(): Promise<void> {
    // Intentionally left empty: revoking these grants would break the control API runtime.
  }
}
