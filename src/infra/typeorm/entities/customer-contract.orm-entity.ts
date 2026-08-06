import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CustomerOrmEntity } from './customer.orm-entity';

export type CustomerContractStatus =
  | 'rascunho'
  | 'em_assinatura'
  | 'ativo'
  | 'encerrado'
  | 'cancelado';

export type CustomerContractCycle =
  | 'mensal'
  | 'trimestral'
  | 'semestral'
  | 'anual'
  | 'customizado';

@Entity({ name: 'customer_contracts', schema: 'control' })
export class CustomerContractOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @ManyToOne(() => CustomerOrmEntity, (customer) => customer.contracts, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'customer_id' })
  customer!: CustomerOrmEntity;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32 })
  code!: string;

  @Column({ type: 'varchar', length: 160 })
  plan!: string;

  @Column({ name: 'plan_id', type: 'varchar', length: 80, nullable: true })
  planId!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'rascunho' })
  status!: CustomerContractStatus;

  @Column({ type: 'varchar', length: 32, default: 'mensal' })
  cycle!: CustomerContractCycle;

  @Column({ name: 'monthly_value', type: 'varchar', length: 80, nullable: true })
  monthlyValue!: string | null;

  @Column({ name: 'setup_value', type: 'varchar', length: 80, nullable: true })
  setupValue!: string | null;

  @Column({ name: 'starts_on', type: 'date', nullable: true })
  startsOn!: string | null;

  @Column({ name: 'ends_on', type: 'date', nullable: true })
  endsOn!: string | null;

  @Column({ name: 'due_day', type: 'varchar', length: 2, nullable: true })
  dueDay!: string | null;

  @Column({ name: 'payment_method', type: 'varchar', length: 120, nullable: true })
  paymentMethod!: string | null;

  @Column({ name: 'signing_contact', type: 'varchar', length: 160, nullable: true })
  signingContact!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
