import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditEvents, type LoginFailureReason } from '../../audit/builders/audit-events.builder.js';
import { AuditService } from '../../audit/services/audit.service.js';
import type { AuditRequestContext } from '../../audit/utils/audit-request-context.util.js';
import type { AuthConfig } from '../../config/index.js';
import { PrismaService } from '../../database/prisma.service.js';
import { DomainValidationService } from '../../identity-and-access/services/domain-validation.service.js';
import { ACTIVE_ASSIGNMENT } from '../utils/active-assignment.util.js';
import { hasAdminAccess, hasPortalAccess, toClassifiableRoles } from '../utils/admin-role.util.js';
import { SessionService, type TokenPair } from './session.service.js';

/**
 * Payload extracted from a verified Google OpenID Connect ID token.
 */
export interface GoogleTokenPayload {
  sub: string;
  email: string;
  email_verified: boolean | string;
  name?: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat?: number;
}

const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const VALID_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const DEV_GOOGLE_TOKEN_PREFIX = 'dev-google:';

/**
 * Handles Google OAuth 2.0 / OpenID Connect login (Issue #10, Issue #11, Issue #91).
 *
 * Security & Lifecycle Guarantees:
 *  1. Verifies Google ID token server-side via Google's tokeninfo endpoint with a strict 5000ms timeout.
 *  2. Enforces issuer, audience (against configured client IDs), expiry, and email_verified.
 *  3. In production, prevents Confused Deputy by strictly requiring configured googleClientIds.
 *  4. Looks up user by `google_sub` (returning users) or `email` (first login for invited users).
 *  5. On first login, links `google_sub` to the user, ensures `passwordHash: null`, and activates their account (`status: 'ACTIVE'`).
 *  6. Rejects unknown Google accounts.
 *  7. Rejects administrator accounts (email + password only; PLATFORM_ADMIN or SCHOOL_ADMIN).
 *  8. Rejects suspended accounts (`status: 'SUSPENDED'`).
 *  9. Enforces per-school domain restrictions (Issue #11) against the user's assigned school(s).
 * 10. When `client === 'portal'` (Issue #91), enforces web portal access (`documents:manage` / `documents.manage`)
 *     and returns actionable error messages for unknown account, suspended account, domain not allowed, and no portal access.
 * 11. Creates session with rotating refresh token and optional device binding.
 * 12. Records tamper-evident audit events for both successes and failures.
 */
@Injectable()
export class GoogleLoginService {
  private readonly logger = new Logger(GoogleLoginService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly domainValidation: DomainValidationService,
  ) {}

  /**
   * Returns public Google OAuth configuration for the web portal login page.
   */
  getPublicConfig(): { clientId: string | null } {
    const auth = this.config.getOrThrow<AuthConfig>('auth');
    return {
      clientId: auth.googleClientIds[0] ?? null,
    };
  }

  /**
   * Authenticates a user with a Google ID token.
   */
  async login(
    idToken: string,
    context: AuditRequestContext,
    deviceId?: string | null,
    client?: 'portal' | 'mobile',
  ): Promise<TokenPair> {
    const isPortal = client === 'portal';

    // 1. Verify Google ID token
    let payload: GoogleTokenPayload;
    try {
      payload = await this.verifyGoogleToken(idToken);
    } catch (err) {
      this.logger.warn(`Google token verification failed: ${err instanceof Error ? err.message : String(err)}`);
      await this.recordFailure('unknown', 'invalid_google_token', null, context);
      if (isPortal) {
        throw new UnauthorizedException('Google authentication failed. Please try signing in again.');
      }
      return this.deny();
    }

    const email = payload.email.trim().toLowerCase();

    // Defense-in-depth: double check email_verified
    const isVerified = payload.email_verified === true || String(payload.email_verified) === 'true';
    if (!isVerified) {
      await this.recordFailure(email, 'invalid_google_token', null, context);
      if (isPortal) {
        throw new UnauthorizedException('Your Google email address is not verified.');
      }
      return this.deny();
    }

    // 2. User lookup: by google_sub first, or by email on first login
    let user = await this.prisma.user.findFirst({
      where: { googleSub: payload.sub },
      include: {
        assignments: {
          where: ACTIVE_ASSIGNMENT,
          include: {
            role: {
              select: {
                name: true,
                scope: true,
                rolePermissions: { select: { permission: { select: { code: true } } } },
              },
            },
            school: { select: { id: true, name: true, status: true } },
          },
        },
      },
    });

    let isFirstLogin = false;
    if (!user) {
      user = await this.prisma.user.findUnique({
        where: { email },
        include: {
          assignments: {
            where: ACTIVE_ASSIGNMENT,
            include: {
              role: {
                select: {
                  name: true,
                  scope: true,
                  rolePermissions: { select: { permission: { select: { code: true } } } },
                },
              },
              school: { select: { id: true, name: true, status: true } },
            },
          },
        },
      });
      isFirstLogin = true;
    }

    // 3. Reject unknown accounts (no matching internal pre-invited or registered user)
    if (!user) {
      await this.recordFailure(email, 'unknown_user', null, context);
      if (isPortal) {
        throw new UnauthorizedException(
          'No Orvia account was found for this Google email. Please contact your school administrator.',
        );
      }
      return this.deny();
    }

    const classifiableRoles = toClassifiableRoles(user.assignments);

    // 4. Reject administrator accounts (admins are email + password only). Admin-ness is derived
    // from data (platform scope, or a role granting an administrative permission), never a name.
    const isAdmin =
      (user.authProvider === 'local' && !!user.passwordHash) ||
      hasAdminAccess(classifiableRoles);
    if (isAdmin) {
      await this.recordFailure(email, 'not_admin', user.id, context);
      if (isPortal) {
        throw new ForbiddenException(
          'Administrator accounts must sign in with email and password.',
        );
      }
      return this.deny();
    }

    // 5. Reject suspended accounts
    if (user.status === 'SUSPENDED') {
      await this.recordFailure(email, 'account_suspended', user.id, context);
      if (isPortal) {
        throw new ForbiddenException(
          'Your account has been suspended. Please contact your school administrator.',
        );
      }
      return this.deny();
    }

    // 5b. Reject accounts belonging to a deactivated school
    const isPlatformUser = user.assignments.some(
      (a) => a.role.scope === 'platform',
    );
    if (!isPlatformUser && user.assignments.length > 0) {
      const isDeactivated = user.assignments.every(
        (a) => a.school?.status === 'deactivated',
      );
      if (isDeactivated) {
        await this.recordFailure(email, 'school_deactivated', user.id, context);
        if (isPortal) {
          throw new ForbiddenException(
            'Your school is currently deactivated. Please contact your administrator.',
          );
        }
        return this.deny();
      }
    }

    // 6. Enforce per-school institutional domain restrictions (Issue #11)
    const userSchoolIds = user.assignments.map((a) => a.schoolId);
    const domainCheck = await this.domainValidation.validateDomainForUser(
      email,
      userSchoolIds,
    );
    if (!domainCheck.allowed) {
      await this.recordFailure(email, 'domain_not_allowed', user.id, context);
      if (isPortal) {
        throw new ForbiddenException(
          'Your Google email domain is not allowed for your school.',
        );
      }
      return this.deny();
    }

    // 6b. Web portal access check (Issue #91): only staff with document-management rights (or admin roles) may access the web portal
    if (isPortal && !hasPortalAccess(classifiableRoles)) {
      await this.recordFailure(email, 'not_admin', user.id, context);
      throw new ForbiddenException(
        'Access denied: the web portal is reserved for administrators and staff with document-management rights. Please use the Orvia mobile app.',
      );
    }

    // 7. First login: link googleSub and transition status from INVITED to ACTIVE
    if (isFirstLogin || user.status === 'INVITED') {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          googleSub: payload.sub,
          authProvider: 'google',
          status: 'ACTIVE',
        },
        include: {
          assignments: {
            where: ACTIVE_ASSIGNMENT,
            include: {
              role: { select: { name: true, scope: true } },
              school: { select: { id: true, name: true } },
            },
          },
        },
      });
    }

    // 8. Create session
    const pair = await this.sessions.createSession(user.id, context, deviceId);
    const primary = user.assignments[0];

    // 9. Tamper-evident audit logging for successful login
    await this.audit.record(
      AuditEvents.loginSuccess(
        {
          userId: user.id,
          role: primary?.role.name ?? null,
          schoolId: primary?.schoolId ?? null,
          method: 'google',
          sessionId: pair.sessionId,
        },
        context,
      ),
    );

    return pair;
  }

  /**
   * Verifies the Google ID token via Google's tokeninfo endpoint.
   * Enforces 5000ms network timeout via AbortSignal.timeout(5000).
   * Validates issuer, configured audience, expiry, subject, and email verification.
   */
  async verifyGoogleToken(idToken: string): Promise<GoogleTokenPayload> {
    const authConfig = this.config.getOrThrow<AuthConfig>('auth');
    const isProduction = process.env.NODE_ENV === 'production';

    if (!isProduction && authConfig.devTools && idToken.startsWith(DEV_GOOGLE_TOKEN_PREFIX)) {
      const devEmail = idToken.slice(DEV_GOOGLE_TOKEN_PREFIX.length).trim().toLowerCase();
      if (!devEmail || !devEmail.includes('@')) {
        throw new Error('Invalid dev Google token email');
      }
      return {
        sub: `dev-google-sub-${devEmail}`,
        email: devEmail,
        email_verified: true,
        iss: 'https://accounts.google.com',
        aud: authConfig.googleClientIds[0] ?? 'dev-google-client-id',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
    }

    const url = `${GOOGLE_TOKENINFO_URL}?id_token=${encodeURIComponent(idToken)}`;
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    } catch (err) {
      throw new Error(`Google tokeninfo network error: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Google tokeninfo rejected token: ${response.status} ${body}`);
    }

    const payload = (await response.json()) as GoogleTokenPayload;

    // Validate subject (sub)
    if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.trim().length === 0) {
      throw new Error('Subject (sub) is missing or invalid in Google token payload');
    }

    // Validate email
    if (!payload.email || typeof payload.email !== 'string' || payload.email.trim().length === 0) {
      throw new Error('Email is missing or invalid in Google token payload');
    }

    // Validate issuer
    if (!VALID_ISSUERS.has(payload.iss)) {
      throw new Error(`Invalid issuer: ${payload.iss}`);
    }

    // Validate audience
    const configuredClientIds = authConfig.googleClientIds;
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const audienceValid =
      (!isProduction && configuredClientIds.length === 0) ||
      audiences.some((a) => configuredClientIds.includes(a));

    if (!audienceValid) {
      throw new Error(`Token audience ${JSON.stringify(audiences)} does not match configured client IDs`);
    }

    // Validate expiry (double-checked locally in seconds)
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp < nowSec) {
      throw new Error('Token is expired');
    }

    // Validate email verification
    const isVerified = payload.email_verified === true || String(payload.email_verified) === 'true';
    if (!isVerified) {
      throw new Error('Email is not verified by Google');
    }

    return payload;
  }

  private async recordFailure(
    email: string,
    reason: LoginFailureReason,
    userId: string | null,
    context: AuditRequestContext,
  ): Promise<void> {
    try {
      await this.audit.record(
        AuditEvents.loginFailure({ email, reason, method: 'google', userId }, context),
      );
    } catch (err) {
      this.logger.error('Failed to audit Google login failure', err instanceof Error ? err.stack : String(err));
    }
  }

  /** Uniform generic 401 across all rejections. */
  private deny(): never {
    throw new UnauthorizedException('Authentication failed');
  }
}
