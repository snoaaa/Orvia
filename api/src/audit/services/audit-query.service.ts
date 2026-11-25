import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { assertSchoolAccess, schoolIdFilter } from '../../auth/utils/school-scope.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { QueryAuditEventsDto } from '../dto/index.js';
import { PaginatedAuditEventsEntity } from '../entities/index.js';
import { AuditEventMapper } from '../mappers/index.js';
import type { AuditChainVerification } from '../utils/audit-hash.util.js';
import { verifyChainWith } from '../utils/audit-chain.util.js';

/** Read side of the audit trail: listing events and verifying the hash chain. */
@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Newest events first.
   *
   * School scoping: a platform-wide `audit:read` (platform-scoped role) sees every event, while a
   * school-scoped admin only sees events whose `schoolId` is one of their schools. Events without a
   * school (platform actions, unknown-user login failures) are therefore invisible to them — without
   * this filter a school admin would read every other school's logins and user changes.
   */
  async findAll(query: QueryAuditEventsDto = {}, actor?: AuthenticatedUser): Promise<PaginatedAuditEventsEntity> {
    const allowedSchools = actor ? schoolIdFilter(actor, 'audit:read') : undefined;
    if (query.schoolId && actor) {
      assertSchoolAccess(actor, 'audit:read', query.schoolId);
    }
    const fromDate = query.from ? this.parseInstant(query.from, false) : undefined;
    const toDate = query.to ? this.parseInstant(query.to, true) : undefined;
    if (fromDate && toDate && fromDate > toDate) {
      throw new BadRequestException('`from` must not be after `to`');
    }
    const where: Prisma.AuditEventWhereInput = {
      ...(query.category && { category: query.category }),
      ...(query.action && { action: query.action }),
      ...(query.actorId && { actorId: query.actorId }),
      ...(query.entityType && { entityType: query.entityType }),
      ...((fromDate || toDate) && {
        createdAt: {
          ...(fromDate && { gte: fromDate }),
          ...(toDate && { lte: toDate }),
        },
      }),
      // The caller's scope is always applied; an (already validated) schoolId narrows it further.
      ...(query.schoolId ? { schoolId: query.schoolId } : allowedSchools ? { schoolId: allowedSchools } : {}),
    };
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const [rows, total] = await Promise.all([
      this.prisma.auditEvent.findMany({ where, orderBy: { seq: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.auditEvent.count({ where }),
    ]);

    // audit_events has no foreign keys by design, so names come from two batched lookups.
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((v): v is string => !!v))];
    const schoolIds = [...new Set(rows.map((r) => r.schoolId).filter((v): v is string => !!v))];
    const [users, schools] = await Promise.all([
      actorIds.length
        ? this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true, email: true } })
        : [],
      schoolIds.length
        ? this.prisma.school.findMany({ where: { id: { in: schoolIds } }, select: { id: true, name: true } })
        : [],
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const schoolById = new Map(schools.map((sc) => [sc.id, sc.name]));

    return {
      data: rows.map((r) =>
        AuditEventMapper.toEntity(r, {
          actorName: (r.actorId && userById.get(r.actorId)?.fullName) || null,
          actorEmail: (r.actorId && userById.get(r.actorId)?.email) || null,
          schoolName: (r.schoolId && schoolById.get(r.schoolId)) || null,
        }),
      ),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  /** Treat date-only ISO inputs (`YYYY-MM-DD`) as whole UTC days so `to` is inclusive. */
  private parseInstant(raw: string, endOfDay: boolean): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return new Date(`${raw}T${endOfDay ? '23:59:59.999Z' : '00:00:00.000Z'}`);
    }
    return new Date(raw);
  }

  /** Re-computes every hash in insertion order. Reads in batches to bound memory. */
  async verifyChain(): Promise<AuditChainVerification> {
    return verifyChainWith(this.prisma);
  }
}
