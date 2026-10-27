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
    private readonly adminLogin: AdminLoginService,
    private readonly googleLogin: GoogleLoginService,
  ) {}

  // ── Issue #8: Admin login ──────────────────────────────────────────────────

  @Post('admin/login')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Admin login with email and password',
    description:
      'Authenticates a platform or school administrator using email + password. ' +
      'Returns a short-lived access token, a refresh token, and session metadata. ' +
      'Non-admin accounts, suspended accounts, and wrong credentials all return the ' +
      'same generic 401 response (no field-level hints). ' +
      'Admin accounts are never subject to school domain restrictions (Issue #11).',
  })
  @ApiResponse({ status: 200, description: 'Login successful — token pair returned', type: TokenPairEntity })
  @ApiResponse({ status: 400, description: 'Validation error (missing or malformed fields)' })
  @ApiResponse({ status: 401, description: 'Invalid credentials (generic — no enumeration hints)' })
  async adminLoginEndpoint(
    @Body() dto: AdminLoginDto,
    @Req() req: Request,
  ): Promise<TokenPairEntity> {
    return this.adminLogin.login(dto.email, dto.password, auditContextFromRequest(req));
  }

  // ── Issue #10: Google OAuth 2.0 login ─────────────────────────────────────

  @Post('google')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Google OAuth 2.0 / OpenID Connect login',
    description:
      'Accepts a Google ID token obtained by the client (e.g. via "Sign In With Google"). ' +
      'The server verifies the token signature, issuer, audience, expiry, and `email_verified`. ' +
      'On first login the user account is linked to Google and status is set to ACTIVE. ' +
      'Rejected cases (all return 401 with the same generic message): ' +
      'invalid/expired token, unverified email, unknown account (not pre-invited), ' +
      'suspended account, admin (password-only) account, or domain restriction violation.',
  })
  @ApiResponse({ status: 200, description: 'Login successful — token pair returned', type: TokenPairEntity })
  @ApiResponse({ status: 400, description: 'Validation error (missing or malformed idToken field)' })
  @ApiResponse({ status: 401, description: 'Authentication failed (generic — no enumeration hints)' })
  async googleLoginEndpoint(
    @Body() dto: GoogleLoginDto,
    @Req() req: Request,
  ): Promise<TokenPairEntity> {
    return this.googleLogin.login(dto.idToken, auditContextFromRequest(req));
  }

  // ── Existing endpoints ────────────────────────────────────────────────────

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
  @ApiResponse({ status: 403, description: 'Account suspended' })
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
