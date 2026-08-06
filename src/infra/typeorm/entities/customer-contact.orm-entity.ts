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

export type CustomerContactRole =
  | 'principal'
  | 'substituto'
  | 'tecnico'
  | 'financeiro'
  | 'juridico'
  | 'outro';

export type CustomerContactPreference = 'email' | 'telefone' | 'whatsapp' | 'call';

@Entity({ name: 'customer_contacts', schema: 'control' })
export class CustomerContactOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @ManyToOne(() => CustomerOrmEntity, (customer) => customer.contacts, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'customer_id' })
  customer!: CustomerOrmEntity;

  @Column({ type: 'varchar', length: 160, nullable: true })
  name!: string | null;

  @Column({ type: 'varchar', length: 320, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  role_title!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'principal' })
  role!: CustomerContactRole;

  @Column({ type: 'varchar', length: 32, default: 'email' })
  preference!: CustomerContactPreference;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
