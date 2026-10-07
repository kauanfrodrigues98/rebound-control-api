import { ContractCourtesyExpiryService } from './contract-courtesy-expiry.service';
import { ContractCancellationService } from './contract-cancellation.service';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { env } from '../../config/env';
import { ContractCommercialService } from './contract-commercial.service';
@Injectable()
export class ContractSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ContractSyncWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  constructor(
    private readonly commercial: ContractCommercialService,
    private readonly courtesyExpiry: ContractCourtesyExpiryService,
    private readonly cancellations: ContractCancellationService,
  ) {}
  onModuleInit() {
    if (env.CONTRACT_COMMERCIAL_SYNC_ENABLED) {
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
      for (let i = 0; i < 10; i++)
        if (!(await this.cancellations.deliver())) break;
      for (let i = 0; i < 10; i++)
        if (!(await this.commercial.deliver())) break;
      await this.courtesyExpiry.run();
    } catch {
      this.logger.warn(
        'Falha ao processar a fila de condições comerciais; as revisões permanecem persistidas.',
      );
    } finally {
      this.running = false;
    }
  }
}
