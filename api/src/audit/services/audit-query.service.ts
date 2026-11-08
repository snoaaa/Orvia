import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { schoolIdFilter } from '../../auth/utils/school-scope.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { QueryAuditEventsDto } from '../dto/index.js';
import { AuditEventEntity } from '../entities/index.js';
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
  async findAll(query: QueryAuditEventsDto = {}, actor?: AuthenticatedUser): Promise<AuditEventEntity[]> {
    const allowedSchools = actor ? schoolIdFilter(actor, 'audit:read') : undefined;
    const where: Prisma.AuditEventWhereInput = {
      ...(query.category && { category: query.category }),
      ...(query.action && { action: query.action }),
      ...(query.actorId && { actorId: query.actorId }),
      ...(query.entityType && { entityType: query.entityType }),
      ...(allowedSchools ? { schoolId: allowedSchools } : {}),
    };
    const rows = await this.prisma.auditEvent.findMany({
      where,
      orderBy: { seq: 'desc' },
      take: query.limit ?? 50,
    });
    return rows.map((r) => AuditEventMapper.toEntity(r));
  }

  /** Re-computes every hash in insertion order. Reads in batches to bound memory. */
  async verifyChain(): Promise<AuditChainVerification> {
    return verifyChainWith(this.prisma);
  }
}
