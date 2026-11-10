import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { schoolsWithPermission } from '../../auth/utils/school-scope.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { OverviewRange } from '../dto/overview-query.dto.js';
import {
  OverviewDocumentsEntity,
  OverviewEntity,
  OverviewRecentEventEntity,
  OverviewSchoolsEntity,
  OverviewSeriesPointEntity,
  OverviewSessionsEntity,
  OverviewSpaceEntity,
  OverviewUsersEntity,
} from '../entities/overview.entity.js';
import { ACTIVE_ASSIGNMENT } from '../../auth/utils/active-assignment.util.js';

/** `all` = platform-wide; otherwise `schoolIds` restricts, and an empty list means "no school". */
interface Scope {
  all: boolean;
  schoolIds: string[];
  allowed: boolean;
}

/**
 * Everything the dashboard needs, in one round trip.
 *
 * Every section is scoped exactly like the list endpoint that owns the data: a platform admin gets
 * platform-wide numbers, a school admin only their own school(s). Sections the caller may not read
 * are omitted (`users:read`, `schools:read`, `users:suspend`, `documents:read`, `spaces:read`,
 * `audit:read` are checked individually), so a narrow role gets a small payload instead of a 403.
 */
@Injectable()
export class OverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(actor: AuthenticatedUser, range: OverviewRange = '7d'): Promise<OverviewEntity> {
    const buckets = buildBuckets(range);
    const since = bucketStart(buckets[0], range);

    const [users, schools, sessions, documents, spaces, series, recent] = await Promise.all([
      this.usersSection(actor),
      this.schoolsSection(actor),
      this.sessionsSection(actor),
      this.documentsSection(actor),
      this.spacesSection(actor),
      this.seriesSection(actor, range, buckets, since),
      this.recentSection(actor),
    ]);

    return new OverviewEntity({
      range,
      scope: actor.isPlatformAdmin ? 'platform' : 'school',
      generatedAt: new Date(),
      ...(users ? { users } : {}),
      ...(schools ? { schools } : {}),
      ...(sessions ? { sessions } : {}),
      ...(documents ? { documents } : {}),
      ...(spaces ? { spaces } : {}),
      ...(series ? { series } : {}),
      ...(recent ? { recent } : {}),
    });
  }

  private scopeFor(actor: AuthenticatedUser, permission: string): Scope {
    const schools = schoolsWithPermission(actor, permission);
    if (schools === 'all') return { all: true, schoolIds: [], allowed: true };
    return { all: false, schoolIds: schools, allowed: schools.length > 0 };
  }

  private async usersSection(actor: AuthenticatedUser): Promise<OverviewUsersEntity | undefined> {
    const scope = this.scopeFor(actor, 'users:read');
    if (!scope.allowed) return undefined;

    const where: Prisma.UserWhereInput = scope.all
      ? {}
      : { assignments: { some: { ...ACTIVE_ASSIGNMENT, schoolId: { in: scope.schoolIds } } } };
    const grouped = await this.prisma.user.groupBy({ by: ['status'], where, _count: true });
    const countOf = (status: string) => grouped.find((g) => g.status === status)?._count ?? 0;

    return new OverviewUsersEntity({
      total: grouped.reduce((sum, g) => sum + g._count, 0),
      active: countOf('ACTIVE'),
      invited: countOf('INVITED'),
      suspended: countOf('SUSPENDED'),
    });
  }

  private async schoolsSection(actor: AuthenticatedUser): Promise<OverviewSchoolsEntity | undefined> {
    const scope = this.scopeFor(actor, 'schools:read');
    if (!scope.allowed) return undefined;

    const where: Prisma.SchoolWhereInput = scope.all ? {} : { id: { in: scope.schoolIds } };
    const grouped = await this.prisma.school.groupBy({ by: ['status'], where, _count: true });
    const countOf = (status: string) => grouped.find((g) => g.status === status)?._count ?? 0;

    return new OverviewSchoolsEntity({
      total: grouped.reduce((sum, g) => sum + g._count, 0),
      active: countOf('active'),
      deactivated: countOf('deactivated'),
    });
  }

  private async sessionsSection(actor: AuthenticatedUser): Promise<OverviewSessionsEntity | undefined> {
    const scope = this.scopeFor(actor, 'users:suspend');
    if (!scope.allowed) return undefined;

    const where: Prisma.SessionWhereInput = {
      revokedAt: null,
      expiresAt: { gt: new Date() },
      ...(scope.all ? {} : { user: { assignments: { some: { ...ACTIVE_ASSIGNMENT, schoolId: { in: scope.schoolIds } } } } }),
    };
    return new OverviewSessionsEntity({ active: await this.prisma.session.count({ where }) });
  }

  private async documentsSection(actor: AuthenticatedUser): Promise<OverviewDocumentsEntity | undefined> {
    const scope = this.scopeFor(actor, 'documents:read');
    if (!scope.allowed) return undefined;

    const where: Prisma.DocumentWhereInput = {
      deletedAt: null,
      ...(scope.all ? {} : { space: { schoolId: { in: scope.schoolIds } } }),
    };
    const [total, spaces, jobs] = await Promise.all([
      this.prisma.document.count({ where }),
      this.prisma.space.count({ where: scope.all ? {} : { schoolId: { in: scope.schoolIds } } }),
      this.prisma.processingJob.groupBy({
        by: ['status'],
        where: scope.all ? {} : { version: { document: { space: { schoolId: { in: scope.schoolIds } } } } },
        _count: true,
      }),
    ]);

    const processingJobs: Record<string, number> = {};
    for (const job of jobs) processingJobs[job.status] = job._count;

    return new OverviewDocumentsEntity({ total, spaces, processingJobs });
  }

  private async spacesSection(actor: AuthenticatedUser): Promise<OverviewSpaceEntity[] | undefined> {
    const scope = this.scopeFor(actor, 'spaces:read');
    if (!scope.allowed) return undefined;

    const rows = await this.prisma.space.findMany({
      where: scope.all ? {} : { schoolId: { in: scope.schoolIds } },
      select: { id: true, name: true, _count: { select: { documents: true } } },
      orderBy: { documents: { _count: 'desc' } },
      take: 7,
    });
    return rows.map((row) => new OverviewSpaceEntity({ id: row.id, name: row.name, documents: row._count.documents }));
  }

  /** Daily (7d/30d) or monthly (12m) buckets, zero-filled so the chart keeps a steady x-axis. */
  private async seriesSection(
    actor: AuthenticatedUser,
    range: OverviewRange,
    buckets: string[],
    since: Date,
  ): Promise<OverviewSeriesPointEntity[] | undefined> {
    const auditScope = this.scopeFor(actor, 'audit:read');
    if (!auditScope.allowed) return undefined;
    const sessionScope = this.scopeFor(actor, 'users:suspend');

    const bucket = Prisma.raw(
      range === '12m' ? "DATE_FORMAT(created_at, '%Y-%m')" : "DATE_FORMAT(created_at, '%Y-%m-%d')",
    );

    const auditRows = await this.prisma.$queryRaw<Array<{ bucket: string; logins: bigint; failed: bigint }>>`
      SELECT ${bucket} AS bucket,
             COUNT(CASE WHEN action = 'login_success' THEN 1 END) AS logins,
             COUNT(CASE WHEN action = 'login_failure' THEN 1 END) AS failed
      FROM audit_events
      WHERE created_at >= ${since}
      ${auditScope.all ? Prisma.empty : Prisma.sql`AND school_id IN (${Prisma.join(auditScope.schoolIds)})`}
      GROUP BY bucket
    `;

    const sessionRows = sessionScope.allowed
      ? await this.prisma.$queryRaw<Array<{ bucket: string; created: bigint }>>`
          SELECT ${bucket} AS bucket, COUNT(*) AS created
          FROM sessions
          WHERE created_at >= ${since}
          ${
            sessionScope.all
              ? Prisma.empty
              : Prisma.sql`AND user_id IN (
                  SELECT user_id FROM user_assignments
                  WHERE deleted_at IS NULL AND school_id IN (${Prisma.join(sessionScope.schoolIds)})
                )`
          }
          GROUP BY bucket
        `
      : [];

    const audit = new Map(auditRows.map((row) => [row.bucket, row]));
    const created = new Map(sessionRows.map((row) => [row.bucket, Number(row.created)]));

    return buckets.map(
      (bucketLabel) =>
        new OverviewSeriesPointEntity({
          bucket: bucketLabel,
          logins: Number(audit.get(bucketLabel)?.logins ?? 0),
          failedLogins: Number(audit.get(bucketLabel)?.failed ?? 0),
          sessionsCreated: created.get(bucketLabel) ?? 0,
        }),
    );
  }

  private async recentSection(actor: AuthenticatedUser): Promise<OverviewRecentEventEntity[] | undefined> {
    const scope = this.scopeFor(actor, 'audit:read');
    if (!scope.allowed) return undefined;

    const rows = await this.prisma.auditEvent.findMany({
      where: scope.all ? {} : { schoolId: { in: scope.schoolIds } },
      orderBy: { seq: 'desc' },
      take: 10,
      select: {
        seq: true,
        category: true,
        action: true,
        actorRole: true,
        entityType: true,
        schoolId: true,
        createdAt: true,
      },
    });
    return rows.map(
      (row) =>
        new OverviewRecentEventEntity({
          seq: Number(row.seq),
          category: row.category,
          action: row.action,
          actorRole: row.actorRole,
          entityType: row.entityType,
          schoolId: row.schoolId,
          at: row.createdAt,
        }),
    );
  }
}

/** Oldest → newest bucket labels: `YYYY-MM-DD` for 7d/30d, `YYYY-MM` for 12m. */
function buildBuckets(range: OverviewRange): string[] {
  const now = new Date();
  if (range === '12m') {
    return Array.from({ length: 12 }, (_, index) => {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - index), 1));
      return date.toISOString().slice(0, 7);
    });
  }
  const days = range === '30d' ? 30 : 7;
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1 - index)));
    return date.toISOString().slice(0, 10);
  });
}

/** Start of the first bucket, so the queries fetch exactly the visible window. */
function bucketStart(firstBucket: string, range: OverviewRange): Date {
  return new Date(range === '12m' ? `${firstBucket}-01T00:00:00.000Z` : `${firstBucket}T00:00:00.000Z`);
}
