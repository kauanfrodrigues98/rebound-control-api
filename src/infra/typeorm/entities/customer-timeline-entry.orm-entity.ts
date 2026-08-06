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

export type CustomerTimelineEntryType =
  | 'ligacao'
  | 'call'
  | 'proposta'
  | 'contrato'
  | 'implantacao'
  | 'observacao';

@Entity({ name: 'customer_timeline_entries', schema: 'control' })
export class CustomerTimelineEntryOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @ManyToOne(() => CustomerOrmEntity, (customer) => customer.timeline, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'customer_id' })
  customer!: CustomerOrmEntity;

  @Column({ type: 'varchar', length: 32, default: 'observacao' })
  type!: CustomerTimelineEntryType;

  @Column({ type: 'varchar', length: 180 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'scheduled_for', type: 'date', nullable: true })
  scheduledFor!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
