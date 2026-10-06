import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { env } from '../../config/env';
import { ContractRecurrenceService } from './contract-recurrence.service';
@Injectable()
export class ContractRecurrenceWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly logger = new Logger(ContractRecurrenceWorker.name);
  constructor(private readonly recurrence: ContractRecurrenceService) {}
  onModuleInit() {
    if (env.CONTRACT_RECURRENCE_ENABLED) {
      this.timer = setInterval(() => {
        void this.run();
      }, 60000);
      this.timer.unref();
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      for (const row of await this.recurrence.due()) {
        try {
          await this.recurrence.process(row.customerId, row.contractId);
        } catch {
          this.logger.warn(
            'Recorrência não processada; o contrato permanece na fila persistida.',
          );
        }
      }
    } catch {
      this.logger.warn('Fila de recorrência indisponível.');
    } finally {
      this.running = false;
    }
  }
}
