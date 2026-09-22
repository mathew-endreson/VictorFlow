import { STATUS_CODES } from 'node:http';
import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

/** Standard reason phrase ("Not Found"), the same text Nest's own error bodies use. */
const reason = (status: number): string => STATUS_CODES[status] ?? 'Error';

interface PgErrorLike {
  code: string;
  message: string;
  constraint?: string;
  detail?: string;
  severity?: string;
  stack?: string;
}

const isPgError = (e: unknown): e is PgErrorLike =>
  typeof e === 'object' &&
  e !== null &&
  typeof (e as PgErrorLike).code === 'string' &&
  /^[0-9A-Z]{5}$/.test((e as PgErrorLike).code) &&
  'severity' in e;

/** Map database errors to HTTP. Our own trigger errors (VF00x) carry safe, human-readable messages. */
export function mapPgError(e: PgErrorLike): { status: number; message: string; code: string } {
  switch (e.code) {
    case 'VF001':
      return { status: HttpStatus.CONFLICT, message: e.message, code: 'IMMUTABLE_RECORD' };
    case 'VF002':
      return { status: HttpStatus.UNPROCESSABLE_ENTITY, message: e.message, code: 'INVALID_JOURNAL_ENTRY' };
    case 'VF003':
      return { status: HttpStatus.UNPROCESSABLE_ENTITY, message: e.message, code: 'FISCAL_YEAR' };
    case 'VF004':
      return { status: HttpStatus.CONFLICT, message: e.message, code: 'INSUFFICIENT_STOCK' };
    case '23505':
      return { status: HttpStatus.CONFLICT, message: 'A record with the same unique value already exists', code: 'DUPLICATE' };
    case '23503':
      return { status: HttpStatus.CONFLICT, message: 'The record is referenced by other data, or refers to something that does not exist', code: 'REFERENCE_VIOLATION' };
    case '23514':
      return { status: HttpStatus.UNPROCESSABLE_ENTITY, message: 'A value violates a data rule', code: 'CHECK_VIOLATION' };
    case '23502':
      return { status: HttpStatus.BAD_REQUEST, message: 'A required value is missing', code: 'NOT_NULL_VIOLATION' };
    case '22P02':
    case '22003':
    case '22007':
    case '22008':
      return { status: HttpStatus.BAD_REQUEST, message: 'A value has an invalid format', code: 'INVALID_INPUT' };
    case '23P01':
      return { status: HttpStatus.CONFLICT, message: 'The record overlaps an existing one', code: 'OVERLAP' };
    case '40P01':
    case '40001':
      return { status: HttpStatus.SERVICE_UNAVAILABLE, message: 'The system is busy, please retry', code: 'RETRY' };
    default:
      return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Internal server error', code: 'INTERNAL' };
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const obj = typeof body === 'string' ? { message: body } : (body as Record<string, unknown>);
      const { statusCode: _s, error: _e, ...rest } = obj;
      res.status(status).json({ statusCode: status, error: reason(status), ...rest });
      return;
    }

    if (isPgError(exception)) {
      const m = mapPgError(exception);
      if (m.status >= 500) this.logger.error(`${exception.code} ${exception.message}`, exception.stack);
      res.status(m.status).json({ statusCode: m.status, error: reason(m.status), message: m.message, code: m.code });
      return;
    }

    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    res.status(500).json({ statusCode: 500, error: 'Internal Server Error', message: 'Internal server error' });
  }
}
