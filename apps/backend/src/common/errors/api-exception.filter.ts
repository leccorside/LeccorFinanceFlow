import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { HttpRequest } from '../../auth/http.js';
import { Prisma } from '../../generated/prisma/client.js';
import { type ApiErrorBody, defaultsForStatus } from './api-error.js';

interface JsonResponse {
  status(code: number): JsonResponse;
  setHeader(name: string, value: string): unknown;
  json(body: unknown): unknown;
  headersSent?: boolean;
}

interface Resolved {
  status: number;
  code: string;
  message: string;
  details: unknown;
}

/** Prisma errors that are expected outcomes, not bugs. Anything else is a 500. */
const PRISMA_STATUS: Record<string, number> = {
  P2025: 404, // record to update/delete not found
  P2002: 409, // unique violation
  P2003: 409, // foreign key violation
};

/**
 * Turns every exception into the public error contract. 5xx responses never expose the
 * original message, stack or driver details; nothing is logged (no technical log by design).
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    const response = http.getResponse<JsonResponse>();
    if (response.headersSent) {
      return;
    }

    const resolved = resolve(exception);
    const body: ApiErrorBody = {
      code: resolved.code,
      message: resolved.message,
      details: resolved.details,
      requestId: request.requestId ?? randomUUID(),
      timestamp: new Date().toISOString(),
    };

    response.setHeader('X-Request-Id', body.requestId);
    response.status(resolved.status).json(body);
  }
}

function resolve(exception: unknown): Resolved {
  if (exception instanceof HttpException) {
    return fromHttpException(exception);
  }

  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    const status = PRISMA_STATUS[exception.code] ?? 500;
    return { status, ...defaultsForStatus(status), details: null };
  }

  // Errors raised by Express middlewares (e.g. body-parser) carry a status/type.
  const middlewareStatus = statusFromMiddlewareError(exception);
  if (middlewareStatus !== null) {
    return {
      status: middlewareStatus,
      ...defaultsForStatus(middlewareStatus),
      details: null,
    };
  }

  return { status: 500, ...defaultsForStatus(500), details: null };
}

function fromHttpException(exception: HttpException): Resolved {
  const status = exception.getStatus();
  const defaults = defaultsForStatus(status);

  if (status >= 500) {
    // Even explicit 5xx messages are replaced, unless they use the contract shape.
    const payload = exception.getResponse();
    if (isContract(payload)) {
      return {
        status,
        code: payload.code,
        message: payload.message ?? defaults.message,
        details: payload.details ?? null,
      };
    }
    return { status, ...defaults, details: null };
  }

  const payload = exception.getResponse();
  if (isContract(payload)) {
    return {
      status,
      code: payload.code,
      message: payload.message ?? defaults.message,
      details: payload.details ?? null,
    };
  }

  // Nest's default shape: { statusCode, message, error }.
  const message =
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as { message?: unknown }).message === 'string'
      ? (payload as { message: string }).message
      : defaults.message;
  return { status, code: defaults.code, message, details: null };
}

function isContract(
  payload: unknown,
): payload is { code: string; message?: string; details?: unknown } {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as { code?: unknown }).code === 'string'
  );
}

function statusFromMiddlewareError(exception: unknown): number | null {
  if (typeof exception !== 'object' || exception === null) {
    return null;
  }
  const { status, statusCode, type } = exception as {
    status?: unknown;
    statusCode?: unknown;
    type?: unknown;
  };
  const value =
    typeof status === 'number'
      ? status
      : typeof statusCode === 'number'
        ? statusCode
        : null;
  if (value !== null && value >= 400 && value < 500 && typeof type === 'string') {
    return value;
  }
  return null;
}
