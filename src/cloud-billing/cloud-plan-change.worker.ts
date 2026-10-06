import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { CloudPlanChangeService } from './cloud-plan-change.service';
import { env } from '../config/env';
@Injectable()
export class CloudPlanChangeWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly logger = new Logger(CloudPlanChangeWorker.name);
  constructor(private readonly service: CloudPlanChangeService) {}
  onModuleInit() {
    if (
      env.CONTRACT_COMMERCIAL_SYNC_ENABLED &&
      env.CONTRACT_RECURRENCE_ENABLED
    ) {
      this.timer = setInterval(() => {
        void this.run();
      }, 5000);
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
      this.logger.warn(
        'Alterações Cloud pendentes; nova tentativa será feita.',
      );
    } finally {
      this.running = false;
    }
  }
}
