import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CustomerContactOrmEntity } from './customer-contact.orm-entity';
import { CustomerContractOrmEntity } from './customer-contract.orm-entity';
import { CustomerTimelineEntryOrmEntity } from './customer-timeline-entry.orm-entity';

export type CustomerStage =
  | 'prospeccao'
  | 'negociacao'
  | 'contratacao'
  | 'implantacao'
  | 'operacao'
  | 'pausado'
  | 'perdido';

export type CustomerEnvironment = 'cloud' | 'self-hosted' | 'hibrido' | 'indefinido';
export type CustomerType = 'lead' | 'prospect' | 'cliente' | 'parceiro';
export type CustomerPriority = 'baixa' | 'media' | 'alta';

@Entity({ name: 'customers', schema: 'control' })
export class CustomerOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 180 })
  name!: string;

  @Column({ type: 'varchar', length: 32, default: 'prospect' })
  type!: CustomerType;

  @Index()
  @Column({ type: 'varchar', length: 32, default: 'prospeccao' })
  stage!: CustomerStage;

  @Column({ name: 'legal_name', type: 'varchar', length: 220, nullable: true })
  legalName!: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  document!: string | null;

  @Index()
  @Column({ type: 'varchar', length: 120, nullable: true })
  segment!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  website!: string | null;

  @Column({ name: 'commercial_owner', type: 'varchar', length: 160, nullable: true })
  commercialOwner!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'media' })
  priority!: CustomerPriority;

  @Column({ name: 'expected_value', type: 'varchar', length: 80, nullable: true })
  expectedValue!: string | null;

  @Column({ name: 'expected_environment', type: 'varchar', length: 32, default: 'indefinido' })
  expectedEnvironment!: CustomerEnvironment;

  @Column({ name: 'technical_owner', type: 'varchar', length: 160, nullable: true })
  technicalOwner!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @OneToMany(() => CustomerContactOrmEntity, (contact) => contact.customer, {
    cascade: true,
  })
  contacts!: CustomerContactOrmEntity[];

  @OneToMany(() => CustomerTimelineEntryOrmEntity, (entry) => entry.customer, {
    cascade: true,
  })
  timeline!: CustomerTimelineEntryOrmEntity[];

  @OneToMany(() => CustomerContractOrmEntity, (contract) => contract.customer, {
    cascade: true,
  })
  contracts!: CustomerContractOrmEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
