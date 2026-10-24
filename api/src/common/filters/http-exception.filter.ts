import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuditEvents } from '../../audit/builders/audit-events.builder.js';
import type { AuditActor } from '../../audit/dto/record-audit-event.input.js';
import type { AuditService } from '../../audit/services/audit.service.js';
import { auditContextFromRequest, isRequestAudited } from '../../audit/utils/audit-request-context.util.js';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  /** When given, every 403 is recorded once as security/access_denied (issue #14). */
  constructor(private readonly audit?: AuditService) {}

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | object = 'Internal server error';
    let errorType = 'InternalServerError';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, unknown>;
        message = (resObj.message as string | object) || exception.message;
        errorType = (resObj.error as string) || exception.name;
      }
    } else if (exception instanceof Error) {
      this.logger.error(
        `Unhandled Exception on ${request.method} ${request.url}: ${exception.message}`,
        exception.stack,
      );
      message = 'An unexpected internal error occurred';
    }

    if (status === HttpStatus.FORBIDDEN) {
      await this.auditAccessDenied(request, message);
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      error: errorType,
      message,
    });
  }

  private async auditAccessDenied(request: Request, message: string | object): Promise<void> {
    // Skip if this request already recorded its own event (e.g. a login_failure), so one
    // incident never produces two rows. Audit failures must not change the HTTP answer.
    if (!this.audit || isRequestAudited(request)) return;
    try {
      await this.audit.record(
        AuditEvents.accessDenied(
          {
            actor: actorFromRequest(request),
            method: request.method,
            path: request.originalUrl.split('?')[0],
            reason: typeof message === 'string' ? message : undefined,
          },
          auditContextFromRequest(request),
        ),
      );
    } catch (error) {
      this.logger.error('Could not audit access_denied', error instanceof Error ? error.stack : error);
    }
  }
}

/** Reads the authenticated user if an auth guard (#13) attached one to the request. */
function actorFromRequest(request: Request): AuditActor | null {
  const user = (request as Request & { user?: Record<string, unknown> }).user;
  if (!user) return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    userId: str(user.id) ?? str(user.sub),
    role: str(user.role),
    schoolId: str(user.schoolId),
  };
}
