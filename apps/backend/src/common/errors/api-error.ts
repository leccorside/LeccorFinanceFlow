import { HttpException, HttpStatus } from '@nestjs/common';

/** Public error contract of every API failure. `details` never carries secrets or other users' data. */
export interface ApiErrorBody {
  code: string;
  message: string;
  details: unknown;
  /** Ephemeral correlation id (also in the X-Request-Id header). Not stored anywhere. */
  requestId: string;
  timestamp: string;
}

const DEFAULTS: Record<number, { code: string; message: string }> = {
  400: { code: 'bad_request', message: 'Requisição inválida.' },
  401: { code: 'unauthenticated', message: 'Sessão inválida ou expirada.' },
  403: { code: 'forbidden', message: 'Acesso negado.' },
  404: { code: 'not_found', message: 'Recurso não encontrado.' },
  405: { code: 'method_not_allowed', message: 'Método não permitido.' },
  409: { code: 'conflict', message: 'Conflito com o estado atual do recurso.' },
  410: { code: 'gone', message: 'O recurso não está mais disponível.' },
  413: { code: 'payload_too_large', message: 'Conteúdo maior que o permitido.' },
  415: { code: 'unsupported_media_type', message: 'Tipo de conteúdo não suportado.' },
  422: { code: 'unprocessable', message: 'A operação não é permitida com esses dados.' },
  429: {
    code: 'rate_limited',
    message: 'Muitas requisições. Tente novamente em instantes.',
  },
  500: { code: 'internal_error', message: 'Erro interno. Tente novamente.' },
  503: { code: 'service_unavailable', message: 'Serviço indisponível no momento.' },
};

export function defaultsForStatus(status: number): { code: string; message: string } {
  return (
    DEFAULTS[status] ??
    (status >= 500
      ? (DEFAULTS[500] as { code: string; message: string })
      : { code: 'error', message: 'Falha na requisição.' })
  );
}

/** Throw this to answer with a specific code/message/details under the error contract. */
export class ApiException extends HttpException {
  constructor(
    status: HttpStatus | number,
    code: string,
    message?: string,
    details?: unknown,
  ) {
    super(
      {
        code,
        message: message ?? defaultsForStatus(status).message,
        details: details ?? null,
      },
      status,
    );
  }
}

/** 404 for both "does not exist" and "belongs to someone else": existence never leaks. */
export class ResourceNotFoundException extends ApiException {
  constructor() {
    super(HttpStatus.NOT_FOUND, 'not_found');
  }
}
