import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ContractTerminationService } from './contract-termination.service';
@Injectable()
export class ContractTerminationWorker
  implements OnModuleInit, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly logger = new Logger(ContractTerminationWorker.name);
  constructor(private readonly service: ContractTerminationService) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.run();
    }, 30000);
    this.timer.unref();
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
      this.logger.warn('Encerramentos aguardam nova tentativa.');
    } finally {
      this.running = false;
    }
  }
}
