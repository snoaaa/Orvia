import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditContextFromRequest } from '../../audit/utils/audit-request-context.util.js';
import { CurrentUser, Public } from '../decorators/auth.decorators.js';
import { AdminLoginDto, GoogleLoginDto, RefreshTokenDto } from '../dto/index.js';
import { ActiveSessionEntity, TokenPairEntity } from '../entities/index.js';
import { AdminLoginService } from '../services/admin-login.service.js';
import { GoogleLoginService } from '../services/google-login.service.js';
import { SessionService } from '../services/session.service.js';
import type { AuthenticatedUser } from '../types/authenticated-user.js';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly sessions: SessionService,
    private readonly adminLoginService: AdminLoginService,
    private readonly googleLoginService: GoogleLoginService,
  ) {}

  @Post('admin/login')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Administrator login (email and password)',
    description:
      'Authenticates platform and school administrators. Rejects non-admin users, suspended accounts, ' +
      'and invalid credentials with a uniform generic error.',
  })
  @ApiResponse({ status: 200, description: 'Authenticated successfully', type: TokenPairEntity })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async adminLogin(@Body() dto: AdminLoginDto, @Req() req: Request): Promise<TokenPairEntity> {
    return this.adminLoginService.login(
      dto.email,
      dto.password,
      auditContextFromRequest(req),
      dto.deviceId,
    );
  }

  @Post('google')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Google OAuth 2.0 / OpenID Connect login',
    description:
      'Authenticates students and non-admin users via institutional Google OAuth. ' +
      'Verifies Google ID token server-side, validates school domain restrictions, ' +
      'links google_sub, and transitions invited users to active status.',
  })
  @ApiResponse({ status: 200, description: 'Authenticated successfully', type: TokenPairEntity })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Authentication failed' })
  async googleLogin(@Body() dto: GoogleLoginDto, @Req() req: Request): Promise<TokenPairEntity> {
    return this.googleLoginService.login(
      dto.idToken,
      auditContextFromRequest(req),
      dto.deviceId,
    );
  }

  @Get('me')
  @ApiBearerAuth('bearer-jwt')
  @ApiOperation({ summary: 'Current user with roles, schools and permissions' })
  @ApiResponse({ status: 200, description: 'The authenticated user' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token, or session revoked' })
  @ApiResponse({ status: 403, description: 'Account suspended or not activated' })
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Exchange a refresh token for a new token pair (rotation)',
    description:
      'The presented refresh token stops working. Presenting an already-used refresh token is treated as theft: ' +
      'the whole session is revoked.',
  })
  @ApiResponse({ status: 200, description: 'New access and refresh tokens', type: TokenPairEntity })
  @ApiResponse({ status: 401, description: 'Invalid, expired, revoked or reused refresh token' })
  @ApiResponse({ status: 403, description: 'Account suspended or school deactivated' })
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request): Promise<TokenPairEntity> {
    return this.sessions.refresh(dto.refreshToken, auditContextFromRequest(req));
  }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth('bearer-jwt')
  @ApiOperation({ summary: 'End the current session: its refresh and access tokens stop working' })
  @ApiResponse({ status: 204, description: 'Logged out' })
  async logout(@CurrentUser() user: AuthenticatedUser, @Req() req: Request): Promise<void> {
    if (!user.sessionId) throw new BadRequestException('This access token is not attached to a session');
    await this.sessions.logout(
      user.sessionId,
      { userId: user.id, role: user.role, schoolId: user.schoolId },
      auditContextFromRequest(req),
    );
  }

  @Get('sessions')
  @ApiBearerAuth('bearer-jwt')
  @ApiOperation({ summary: 'My active sessions and their devices' })
  @ApiResponse({ status: 200, type: [ActiveSessionEntity] })
  async mySessions(@CurrentUser() user: AuthenticatedUser): Promise<ActiveSessionEntity[]> {
    const rows = await this.sessions.listActive(user.id);
    return rows.map((r) => ActiveSessionEntity.from(r, user.sessionId));
  }

  @Delete('sessions/:sessionId')
  @HttpCode(204)
  @ApiBearerAuth('bearer-jwt')
  @ApiOperation({ summary: 'Revoke one of my sessions (e.g. a lost phone)' })
  @ApiParam({ name: 'sessionId', description: 'Session UUID' })
  @ApiResponse({ status: 204, description: 'Session revoked' })
  @ApiResponse({ status: 404, description: 'Not one of my sessions' })
  async revokeMySession(
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.sessions.revokeUserSession(
      user.id,
      sessionId,
      'user_request',
      { userId: user.id, role: user.role, schoolId: user.schoolId },
      auditContextFromRequest(req),
    );
  }
}
