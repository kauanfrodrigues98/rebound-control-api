import {
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { env } from '../config/env';
interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  actorId?: string;
  key?: string;
  access?: string;
}
@Injectable()
export class BillingAdminClient {
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.fetch(path, options);
    const payload = (await response.json()) as { data: T };
    return payload.data;
  }
  async document(path: string, access?: string) {
    const response = await this.fetch(path, { access });
    return {
      body: Buffer.from(await response.arrayBuffer()),
      type: response.headers.get('content-type') ?? 'application/octet-stream',
      disposition: response.headers.get('content-disposition') ?? 'attachment',
    };
  }
  private async fetch(path: string, options: RequestOptions) {
    if (!env.BILLING_ADMIN_API_KEY)
      throw new ServiceUnavailableException(
        'O serviço financeiro não está configurado.',
      );
    let response: Response;
    try {
      response = await fetch(
        `${env.BILLING_SERVICE_URL.replace(/\/+$/, '')}/api${path}`,
        {
          method: options.method ?? 'GET',
          signal: AbortSignal.timeout(45000),
          redirect: 'error',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-api-key': env.BILLING_ADMIN_API_KEY,
            ...(options.actorId ? { 'x-operator-id': options.actorId } : {}),
            ...(options.key ? { 'idempotency-key': options.key } : {}),
            ...(options.access ? { 'x-financial-access': options.access } : {}),
          },
          body:
            options.body === undefined
              ? undefined
              : JSON.stringify(options.body),
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        'Não foi possível acessar o serviço financeiro.',
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpException(
        'A operação financeira não pôde ser concluída.',
        [400, 401, 403, 404, 409, 422, 503].includes(response.status)
          ? response.status
          : 502,
      );
    }
    return response;
  }
}
