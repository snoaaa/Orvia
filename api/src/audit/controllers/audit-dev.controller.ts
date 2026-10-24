import {
  Body,
  CanActivate,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  ParseEnumPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuditEvents } from '../builders/audit-events.builder.js';
import type { RecordAuditEventInput } from '../dto/index.js';
import { SimulateAuditEventDto } from '../dto/index.js';
import { AuditEventEntity } from '../entities/index.js';
import { AuditService } from '../services/audit.service.js';
import { auditContextFromRequest } from '../utils/audit-request-context.util.js';

/** Hidden (404) unless AUDIT_DEV_TOOLS=true and not in production. */
@Injectable()
class AuditDevToolsGuard implements CanActivate {
  canActivate(): boolean {
    if (process.env.AUDIT_DEV_TOOLS === 'true' && process.env.NODE_ENV !== 'production') return true;
    throw new NotFoundException();
  }
}

enum SimulatedEvent {
  LoginSuccess = 'login-success',
  LoginFailure = 'login-failure',
  Logout = 'logout',
  TokenRefreshFailure = 'token-refresh-failure',
  SessionRevoked = 'session-revoked',
  UserInvited = 'user-invited',
  AccountLocked = 'account-locked',
}

/**
 * DEV-ONLY. Login, refresh, logout and the guards (#8, #10, #12, #13) do not exist yet,
 * so these routes fire the same audit events those features will fire, to test #14 end to end.
 * Remove once the real auth endpoints are merged.
 */
@ApiTags('Audit Trail (dev tools)')
@UseGuards(AuditDevToolsGuard)
@Controller('audit/dev')
export class AuditDevController {
  constructor(private readonly audit: AuditService) {}

  @Post('simulate/:event')
  @HttpCode(201)
  @ApiOperation({ summary: '[DEV] Record a simulated auth event' })
  @ApiParam({ name: 'event', enum: SimulatedEvent })
  async simulate(
    @Param('event', new ParseEnumPipe(SimulatedEvent)) event: SimulatedEvent,
    @Body() body: SimulateAuditEventDto,
    @Req() req: Request,
  ): Promise<AuditEventEntity> {
    const ctx = auditContextFromRequest(req);
    const email = body.email ?? 'jane.doe@school.edu';
    const userId = body.userId ?? '00000000-0000-0000-0000-000000000001';
    const sessionId = body.sessionId ?? '00000000-0000-0000-0000-0000000000aa';

    const input: Record<SimulatedEvent, () => RecordAuditEventInput> = {
      [SimulatedEvent.LoginSuccess]: () =>
        AuditEvents.loginSuccess({ userId, role: body.role, method: 'password', sessionId }, ctx),
      [SimulatedEvent.LoginFailure]: () => ({
        ...AuditEvents.loginFailure({ email, reason: 'invalid_credentials', method: 'password' }, ctx),
        // Simulates a careless caller passing the whole request body: the secrets must be redacted.
        details: Object.assign<Record<string, unknown>, SimulateAuditEventDto, Record<string, unknown>>(
          {},
          body,
          { reason: 'invalid_credentials', method: 'password' },
        ),
      }),
      [SimulatedEvent.Logout]: () => AuditEvents.logout({ userId, role: body.role, sessionId }, ctx),
      [SimulatedEvent.TokenRefreshFailure]: () => ({
        ...AuditEvents.tokenRefreshFailure({ reason: 'reused', userId, sessionId }, ctx),
        details: { reason: 'reused', refreshToken: body.refreshToken },
      }),
      [SimulatedEvent.SessionRevoked]: () =>
        AuditEvents.sessionRevoked(
          { sessionId, ownerUserId: userId, reason: 'admin_action', revokedBy: { userId: 'dev-admin', role: 'PLATFORM_ADMIN' } },
          ctx,
        ),
      [SimulatedEvent.UserInvited]: () =>
        AuditEvents.userInvited({ invitedUserId: userId, email, invitedBy: { userId: 'dev-admin', role: 'PLATFORM_ADMIN' } }, ctx),
      [SimulatedEvent.AccountLocked]: () =>
        AuditEvents.accountLocked({ email, userId, reason: 'too_many_failed_logins', failedAttempts: 5 }, ctx),
    };

    return this.audit.record(input[event]());
  }

  @Get('forbidden')
  @ApiOperation({ summary: '[DEV] Always answers 403, which the exception filter audits as access_denied' })
  forbidden(): never {
    throw new ForbiddenException('Simulated missing permission');
  }
}
