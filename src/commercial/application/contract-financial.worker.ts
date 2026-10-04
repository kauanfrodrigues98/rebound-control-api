import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ContractFinancialService } from './contract-financial.service';
import { env } from '../../config/env';
@Injectable()
export class ContractFinancialWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly logger = new Logger(ContractFinancialWorker.name);
  constructor(private readonly service: ContractFinancialService) {}
  onModuleInit() {
    if (env.CONTRACT_FINANCIAL_SYNC_ENABLED) {
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
      await this.service.run();
    } catch {
      this.logger.warn('Integração financeira pendente.');
    } finally {
      this.running = false;
    }
  }
}
