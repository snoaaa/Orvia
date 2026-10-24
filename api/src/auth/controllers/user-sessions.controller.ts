import { Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditContextFromRequest } from '../../audit/utils/audit-request-context.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import { CurrentUser, RequirePermission } from '../decorators/auth.decorators.js';
import { ActiveSessionEntity } from '../entities/index.js';
import { SessionService } from '../services/session.service.js';
import type { AuthenticatedUser } from '../types/authenticated-user.js';
import { assertSchoolAccess } from '../utils/school-scope.util.js';

/** Admin view of another user's sessions, scoped to the admin's schools (#12). */
@ApiTags('Identity and Access')
@ApiBearerAuth('bearer-jwt')
@ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
@ApiResponse({ status: 403, description: 'Missing permission, suspended account, or another school' })
@Controller('identity/users/:userId/sessions')
export class UserSessionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  @Get()
  @RequirePermission('users:read')
  @ApiOperation({ summary: "List a user's active sessions and devices" })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  @ApiResponse({ status: 200, type: [ActiveSessionEntity] })
  async list(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ActiveSessionEntity[]> {
    await this.assertUserInScope(userId, actor, 'users:read');
    const rows = await this.sessions.listActive(userId);
    return rows.map((r) => ActiveSessionEntity.from(r, null));
  }

  @Delete()
  @RequirePermission('users:suspend')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke all sessions of a user (e.g. compromised account)' })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  @ApiResponse({ status: 200, description: '{ revoked: number }' })
  async revokeAll(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<{ revoked: number }> {
    await this.assertUserInScope(userId, actor, 'users:suspend');
    const revoked = await this.sessions.revokeAllForUser(
      userId,
      'admin_action',
      { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
      auditContextFromRequest(req),
    );
    return { revoked };
  }

  @Delete(':sessionId')
  @RequirePermission('users:suspend')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke one session of a user' })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  @ApiParam({ name: 'sessionId', description: 'Session UUID' })
  async revokeOne(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.assertUserInScope(userId, actor, 'users:suspend');
    await this.sessions.revokeUserSession(
      userId,
      sessionId,
      'admin_action',
      { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
      auditContextFromRequest(req),
    );
  }

  private async assertUserInScope(userId: string, actor: AuthenticatedUser, permission: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { assignments: { select: { schoolId: true } } },
    });
    if (!user) throw new NotFoundException(`User with ID ${userId} not found`);
    assertSchoolAccess(actor, permission, user.assignments.map((a) => a.schoolId));
  }
}
