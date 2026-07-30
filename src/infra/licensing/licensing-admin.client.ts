import { HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { env } from '../../config/env';

type LicensingMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface LicensingRequestOptions {
  method?: LicensingMethod;
  body?: unknown;
}

@Injectable()
export class LicensingAdminClient {
  private readonly baseUrl = env.LICENSING_SERVICE_URL.replace(/\/+$/, '');

  async request<TResponse>(
    path: string,
    options: LicensingRequestOptions = {},
  ): Promise<TResponse> {
    if (!env.LICENSING_ADMIN_API_KEY) {
      throw new ServiceUnavailableException(
        'A chave interna do serviço de licenciamento não está configurada.',
      );
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      headers: {
        'Content-Type': 'application/json',
        'x-admin-api-key': env.LICENSING_ADMIN_API_KEY,
      },
    });

    const payload = await this.parseResponse(response);

    if (!response.ok) {
      throw new HttpException(
        this.extractMessage(payload) ??
          'A comunicação interna com o serviço de licenciamento falhou.',
        response.status,
      );
    }

    return payload as TResponse;
  }

  private async parseResponse(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return {};

    try {
      return JSON.parse(text);
    } catch {
      return { message: text };
    }
  }

  private extractMessage(payload: unknown): string | null {
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'message' in payload
    ) {
      const message = payload.message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.join(' ');
    }

    return null;
  }
}
