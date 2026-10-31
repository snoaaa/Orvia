import { ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AuditEvents, type SessionRevocationReason, type TokenRefreshFailureReason } from '../../audit/builders/audit-events.builder.js';
import type { AuditActor } from '../../audit/dto/record-audit-event.input.js';
import { AuditService } from '../../audit/services/audit.service.js';
import type { AuditRequestContext } from '../../audit/utils/audit-request-context.util.js';
import type { AuthConfig } from '../../config/index.js';
import { PrismaService } from '../../database/prisma.service.js';
import { TokenService } from './token.service.js';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  /** Access token lifetime in seconds. */
  expiresIn: number;
  sessionId: string;
  /** When the session ends for good (refreshing does not extend it). */
  refreshExpiresAt: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Stateful side of authentication (#12).
 *
 * Refresh token format: `<sessionId>.<secret>`, where `secret` is 32 random bytes (base64url).
 * Only SHA-256(secret) is stored, in sessions.refresh_token_hash, and it is replaced on every
 * refresh. A token whose session exists but whose secret no longer matches is an OLD token
 * being replayed (likely stolen): the whole session is revoked.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Starts a session and returns its first token pair. Login (#8 admin, #10 Google) must call
   * this after checking the credentials. `deviceId` is kept only if it is a device of this user.
   */
  async createSession(
    userId: string,
    context: AuditRequestContext,
    deviceId?: string | null,
  ): Promise<TokenPair> {
    const device = deviceId
      ? await this.prisma.device.findFirst({ where: { id: deviceId, userId }, select: { id: true } })
      : null;
    const { secret, hash } = newSecret();
    const session = await this.prisma.session.create({
      data: {
        userId,
        deviceId: device?.id ?? null,
        refreshTokenHash: hash,
        expiresAt: new Date(Date.now() + this.authConfig().refreshTtlDays * DAY_MS),
        lastUsedAt: new Date(),
        ip: context.ip,
        userAgent: context.userAgent,
      },
    });
    return this.pair(userId, session.id, secret, session.expiresAt);
  }

  /**
   * Validates a refresh token and rotates it: returns a new pair, and the presented token
   * stops working. Every rejection is audited as token_refresh_failure.
   */
  async refresh(refreshToken: string, context: AuditRequestContext, afterLostRace = false): Promise<TokenPair> {
    const parsed = parseRefreshToken(refreshToken);
    if (!parsed) return this.rejectRefresh('invalid_token', context);

    const session = await this.prisma.session.findUnique({
      where: { id: parsed.sessionId },
      include: {
        user: {
          select: {
            id: true,
            status: true,
            assignments: {
              include: {
                role: { select: { scope: true } },
                school: { select: { id: true, status: true } },
              },
            },
          },
        },
      },
    });
    if (!session) return this.rejectRefresh('session_not_found', context);

    const failure = { userId: session.userId, sessionId: session.id };
    if (session.revokedAt) return this.rejectRefresh('revoked', context, failure);
    if (session.expiresAt <= new Date()) return this.rejectRefresh('expired', context, failure);

    const presented = sha256(parsed.secret);
    const isCurrent = !!session.refreshTokenHash && sameHash(presented, session.refreshTokenHash);
    const isGraceRetry = !isCurrent && this.withinReuseGrace(session, presented);
    if (!isCurrent && !isGraceRetry) {
      await this.revokeSession(session.id, 'token_reuse', null, context);
      return this.rejectRefresh('reused', context, failure);
    }
    if (session.user.status === 'SUSPENDED') {
      return this.rejectRefresh('user_suspended', context, failure, true);
    }

    const isPlatformAdmin = session.user.assignments?.some(
      (a) => a.role?.scope === 'platform',
    );
    if (!isPlatformAdmin && (session.user.assignments?.length ?? 0) > 0) {
      const isDeactivated = session.user.assignments.every(
        (a) => a.school?.status === 'deactivated',
      );
      if (isDeactivated) {
        return this.rejectRefresh('school_deactivated', context, failure, true);
      }
    }

    // Compare-and-swap on the current hash, so two requests can never both rotate from the
    // same state. Normal rotation keeps the replaced hash as `previous` for the grace window;
    // a grace retry keeps `previous` unchanged (the token the client still holds) and only
    // replaces the pair it never received.
    const { secret, hash } = newSecret();
    const now = new Date();
    const rotated = await this.prisma.session.updateMany({
      where: { id: session.id, refreshTokenHash: session.refreshTokenHash, revokedAt: null },
      data: {
        refreshTokenHash: hash,
        ...(isCurrent && { previousRefreshTokenHash: session.refreshTokenHash, refreshRotatedAt: now }),
        lastUsedAt: now,
        ip: context.ip,
        userAgent: context.userAgent,
      },
    });
    if (rotated.count !== 1) {
      // Lost the race: another request rotated this session in between. Re-check once on the
      // fresh state, which applies the same rules (grace window or reuse); losing twice means
      // real contention on a copied token.
      if (!afterLostRace) return this.refresh(refreshToken, context, true);
      await this.revokeSession(session.id, 'token_reuse', null, context);
      return this.rejectRefresh('reused', context, failure);
    }
    if (isGraceRetry) {
      this.logger.log(`Refresh token reused within the grace window on session ${session.id}: accepted as a retry`);
    }
    return this.pair(session.userId, session.id, secret, session.expiresAt);
  }

  /** True if `presentedHash` is the token replaced by the last rotation, still inside the grace window. */
  private withinReuseGrace(
    session: { previousRefreshTokenHash: string | null; refreshRotatedAt: Date | null },
    presentedHash: string,
  ): boolean {
    const graceMs = this.authConfig().refreshReuseGraceSeconds * 1000;
    return (
      graceMs > 0 &&
      !!session.previousRefreshTokenHash &&
      !!session.refreshRotatedAt &&
      Date.now() - session.refreshRotatedAt.getTime() <= graceMs &&
      sameHash(presentedHash, session.previousRefreshTokenHash)
    );
  }

  /** Ends the current session. Idempotent: logging out twice is not an error. */
  async logout(
    sessionId: string,
    actor: { userId: string; role?: string | null; schoolId?: string | null },
    context: AuditRequestContext,
  ): Promise<void> {
    const result = await this.prisma.session.updateMany({
      where: { id: sessionId, userId: actor.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 1) {
      await this.audit.record(AuditEvents.logout({ ...actor, sessionId }, context));
    }
  }

  /** Active (not revoked, not expired) sessions of a user, newest first, with their device. */
  async listActive(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { device: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Revokes one session of `userId`. 404 if it does not belong to that user. */
  async revokeUserSession(
    userId: string,
    sessionId: string,
    reason: SessionRevocationReason,
    revokedBy: AuditActor | null,
    context: AuditRequestContext,
  ): Promise<void> {
    const session = await this.prisma.session.findFirst({ where: { id: sessionId, userId } });
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    await this.revokeSession(sessionId, reason, revokedBy, context);
  }

  /** Revokes every active session of a user (e.g. on suspension). Returns how many. */
  async revokeAllForUser(
    userId: string,
    reason: SessionRevocationReason,
    revokedBy: AuditActor | null,
    context: AuditRequestContext,
  ): Promise<number> {
    const active = await this.prisma.session.findMany({
      where: { userId, revokedAt: null },
      select: { id: true },
    });
    for (const { id } of active) {
      await this.revokeSession(id, reason, revokedBy, context);
    }
    return active.length;
  }

  /** True if the session can still be used by an access token. */
  async isActive(sessionId: string): Promise<boolean> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { revokedAt: true, expiresAt: true },
    });
    return !!session && !session.revokedAt && session.expiresAt > new Date();
  }

  /** Deletes sessions that expired or were revoked more than the retention period ago. */
  async deleteStaleSessions(): Promise<number> {
    const cutoff = new Date(Date.now() - this.authConfig().sessionRetentionDays * DAY_MS);
    const { count } = await this.prisma.session.deleteMany({
      where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
    });
    return count;
  }

  private async revokeSession(
    sessionId: string,
    reason: SessionRevocationReason,
    revokedBy: AuditActor | null,
    context: AuditRequestContext,
  ): Promise<void> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId }, select: { userId: true } });
    const result = await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), refreshTokenHash: null },
    });
    if (session && result.count === 1) {
      await this.audit.record(
        AuditEvents.sessionRevoked({ sessionId, ownerUserId: session.userId, reason, revokedBy }, context),
      );
    }
  }

  private async rejectRefresh(
    reason: TokenRefreshFailureReason,
    context: AuditRequestContext,
    ids: { userId?: string; sessionId?: string } = {},
    forbidden = false,
  ): Promise<never> {
    try {
      await this.audit.record(AuditEvents.tokenRefreshFailure({ reason, ...ids }, context));
    } catch (error) {
      this.logger.error('Could not audit token_refresh_failure', error instanceof Error ? error.stack : error);
    }
    // One generic message for every token problem: do not tell an attacker why it failed.
    if (forbidden) {
      if (reason === 'school_deactivated') {
        throw new ForbiddenException('School is deactivated');
      }
      throw new ForbiddenException('Account suspended');
    }
    throw new UnauthorizedException('Invalid refresh token');
  }

  private async pair(userId: string, sessionId: string, secret: string, refreshExpiresAt: Date): Promise<TokenPair> {
    const access = await this.tokens.issueAccessToken(userId, sessionId);
    return { ...access, refreshToken: `${sessionId}.${secret}`, sessionId, refreshExpiresAt };
  }

  private authConfig(): AuthConfig {
    return this.config.getOrThrow<AuthConfig>('auth');
  }
}

function newSecret(): { secret: string; hash: string } {
  const secret = randomBytes(32).toString('base64url');
  return { secret, hash: sha256(secret) };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseRefreshToken(token: string): { sessionId: string; secret: string } | null {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const sessionId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  return UUID.test(sessionId) && secret.length >= 32 ? { sessionId, secret } : null;
}
