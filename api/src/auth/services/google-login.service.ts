import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditEvents } from '../../audit/builders/audit-events.builder.js';
import { AuditService } from '../../audit/services/audit.service.js';
import type { AuditRequestContext } from '../../audit/utils/audit-request-context.util.js';
import type { AuthConfig } from '../../config/index.js';
import { PrismaService } from '../../database/prisma.service.js';
import { DomainValidationService } from '../../identity-and-access/services/domain-validation.service.js';
import { SessionService, type TokenPair } from './session.service.js';

/**
 * Payload extracted from a verified Google OpenID Connect ID token.
 * We do NOT use the google-auth-library to avoid the dependency;
 * instead we verify using Google's public key endpoint.
 */
export interface GoogleTokenPayload {
  sub: string;          // Google subject identifier (stable, unique per user)
  email: string;
  email_verified: boolean;
  name?: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
}

/** Google's token-info endpoint — fastest way to verify without a signing-key cache. */
const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

/** Accepted issuers for Google ID tokens. */
const VALID_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

/** Timeout in milliseconds for the Google tokeninfo fetch call. */
const GOOGLE_FETCH_TIMEOUT_MS = 5000;

/**
 * Handles Google OAuth 2.0 / OpenID Connect login (Issue #10).
 * Domain restriction (Issue #11) is applied here after token verification.
 *
 * Flow:
 *  1. Verify the Google ID token via Google's tokeninfo endpoint.
 *  2. Check signature, issuer, audience, expiry, email_verified.
 *  3. Look up the internal user by `google_sub`, or by email on first login.
 *  4. First-time login: link `google_sub`, set status → ACTIVE.
 *  5. Apply domain restriction (Issue #11) — skipped for admin accounts.
 *  6. Create session and return token pair.
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

  async login(idToken: string, context: AuditRequestContext): Promise<TokenPair> {
    // ── Step 1: Verify the Google ID token ──────────────────────────────────
    let payload: GoogleTokenPayload;
    try {
      payload = await this.verifyGoogleToken(idToken);
    } catch (err) {
      this.logger.warn('Google token verification failed', err instanceof Error ? err.message : err);
      await this.recordFailure('unknown', 'invalid_google_token', null, context);
      return this.deny();
    }

    const email = payload.email.trim().toLowerCase();

    // ── Step 2: email must be verified by Google ─────────────────────────────
    if (!payload.email_verified) {
      await this.recordFailure(email, 'invalid_google_token', null, context);
      return this.deny();
    }

    // ── Step 3: Find internal user by google_sub (returning users) or email (first login) ──
    let user = await this.prisma.user.findFirst({
      where: { googleSub: payload.sub },
      include: { assignments: { include: { role: { select: { name: true, scope: true } } } } },
    });

    let isFirstLogin = false;
    if (!user) {
      // First login: try to find by email (must be a pre-invited account).
      user = await this.prisma.user.findUnique({
        where: { email },
        include: { assignments: { include: { role: { select: { name: true, scope: true } } } } },
      });
      isFirstLogin = true;
    }

    // ── Step 4: Reject unknown accounts ─────────────────────────────────────
    if (!user) {
      await this.recordFailure(email, 'unknown_user', null, context);
      return this.deny();
    }

    // ── Step 5: Reject admin accounts by ROLE (not by authProvider/passwordHash) ─────
    // Admin accounts use email + password exclusively; they must not use Google OAuth.
    // We check by role rather than by authProvider because an admin without a password
    // hash yet (e.g. newly created) would otherwise pass the old authProvider check.
    const isAdmin = user.assignments.some(
      (a) => a.role.scope === 'platform' || a.role.name === 'SCHOOL_ADMIN',
    );
    if (isAdmin) {
      await this.recordFailure(email, 'invalid_google_token', user.id, context);
      return this.deny();
    }

    // ── Step 6: Reject suspended accounts ────────────────────────────────────
    if (user.status === 'SUSPENDED') {
      await this.recordFailure(email, 'account_suspended', user.id, context);
      return this.deny();
    }

    // ── Step 7: Domain restriction (Issue #11) ───────────────────────────────
    // Checked per-school: for each school the user is assigned to, if that school
    // has configured domains, the user's email domain must match one of them.
    // This is NOT a global lookup — an unknown domain does NOT mean "no restriction".
    const emailDomain = this.domainValidation.extractDomain(email);
    if (emailDomain) {
      const domainResult = await this.domainValidation.validateDomainForGoogleLogin(emailDomain, user.id);
      if (domainResult.allowed === false) {
        // Domain restriction: user's school requires a different domain.
        await this.recordFailure(email, 'domain_not_allowed', user.id, context);
        return this.deny();
      }
      // domainResult.allowed === null → no school configured any domains → no restriction.
      // domainResult.allowed === true → user's email domain matches their school's list.
    }

    // ── Step 8: First login — link google_sub and activate account ───────────
    if (isFirstLogin) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          googleSub: payload.sub,
          authProvider: 'google',
          status: 'ACTIVE',
        },
        include: { assignments: { include: { role: { select: { name: true, scope: true } } } } },
      });
    }

    // ── Step 9: Create session ───────────────────────────────────────────────
    const pair = await this.sessions.createSession(user.id, context);

    const primary = user.assignments[0];
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
   * Verifies a Google ID token using Google's tokeninfo endpoint.
   *
   * A 5-second AbortSignal timeout is applied so that a slow or hanging Google
   * endpoint does not stall the request indefinitely.
   *
   * For production use you may want to replace this with the `google-auth-library`
   * for local public-key verification (avoids a network round-trip). The tokeninfo
   * endpoint is reliable for low-traffic scenarios and needs no key-rotation logic.
   */
  private async verifyGoogleToken(idToken: string): Promise<GoogleTokenPayload> {
    const url = `${GOOGLE_TOKENINFO_URL}?id_token=${encodeURIComponent(idToken)}`;

    // Add a timeout so a hanging Google endpoint never stalls a request indefinitely.
    const response = await fetch(url, { signal: AbortSignal.timeout(GOOGLE_FETCH_TIMEOUT_MS) });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Google tokeninfo rejected token: ${response.status} ${body}`);
    }

    const payload = (await response.json()) as GoogleTokenPayload;

    // Validate issuer.
    if (!VALID_ISSUERS.has(payload.iss)) {
      throw new Error(`Invalid issuer: ${payload.iss}`);
    }

    // Validate audience (our client ID must be in aud).
    // SECURITY: In production, auth.config.ts guarantees googleClientIds.length > 0.
    // We NEVER skip audience validation, even in development — if no client IDs are
    // configured in dev, all tokens are simply rejected (avoid Confused Deputy attacks).
    const configuredClientIds = this.config.getOrThrow<AuthConfig>('auth').googleClientIds;
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const audienceValid = audiences.some((a) => configuredClientIds.includes(a));
    if (!audienceValid) {
      throw new Error(`Token audience ${JSON.stringify(audiences)} does not match configured client IDs`);
    }

    // Validate expiry (Google's endpoint already checks this, but double-check locally).
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      throw new Error('Token is expired');
    }

    return payload;
  }

  private async recordFailure(
    email: string,
    reason: 'invalid_google_token' | 'account_suspended' | 'unknown_user' | 'domain_not_allowed',
    userId: string | null,
    context: AuditRequestContext,
  ): Promise<void> {
    try {
      await this.audit.record(
        AuditEvents.loginFailure({ email, reason, method: 'google', userId }, context),
      );
    } catch (err) {
      this.logger.error('Failed to audit Google login failure', err instanceof Error ? err.stack : err);
    }
  }

  /** Throws a generic 401 — never reveals the real failure reason to the caller. */
  private deny(): never {
    throw new UnauthorizedException('Authentication failed');
  }
}
