import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  health() {
    return {
      service: 'rebound-control-api',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
