import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
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

    // ── Step 5: Reject admin (local-only) accounts ───────────────────────────
    // Admin accounts use email + password exclusively; they must not use Google OAuth.
    if (user.authProvider === 'local' && user.passwordHash) {
      await this.recordFailure(email, 'invalid_google_token', user.id, context);
      return this.deny();
    }

    // ── Step 6: Reject suspended accounts ────────────────────────────────────
    if (user.status === 'SUSPENDED') {
      await this.recordFailure(email, 'account_suspended', user.id, context);
      return this.deny();
    }

    // ── Step 7: Domain restriction (Issue #11) ───────────────────────────────
    // Only applied to non-admin accounts; admin (local) accounts are explicitly excluded.
    // Rule: if the domain is not registered in school_domains for any school, no restriction.
    const emailDomain = this.domainValidation.extractDomain(email);
    if (emailDomain) {
      const domainResult = await this.domainValidation.validateDomainForGoogleLogin(emailDomain, user.id);
      if (domainResult.allowed === false) {
        // Domain is configured for a school but user is not assigned there.
        await this.recordFailure(email, 'domain_not_allowed', user.id, context);
        return this.deny();
      }
      // domainResult.allowed === null → no domain config → no restriction (pass through).
      // domainResult.allowed === true → user is assigned to the domain's school → proceed.
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
   * For production use you may want to replace this with the `google-auth-library`
   * for local public-key verification (avoids a network round-trip). The tokeninfo
   * endpoint is reliable for low-traffic scenarios and needs no key-rotation logic.
   */
  private async verifyGoogleToken(idToken: string): Promise<GoogleTokenPayload> {
    const url = `${GOOGLE_TOKENINFO_URL}?id_token=${encodeURIComponent(idToken)}`;
    const response = await fetch(url);

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
    const configuredClientIds = this.config.getOrThrow<AuthConfig>('auth').googleClientIds;
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const audienceValid =
      configuredClientIds.length === 0 || // Dev mode: skip audience check if no client IDs configured.
      audiences.some((a) => configuredClientIds.includes(a));
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
