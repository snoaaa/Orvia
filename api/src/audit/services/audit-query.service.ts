import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
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

  async findAll(query: QueryAuditEventsDto = {}): Promise<AuditEventEntity[]> {
    const where: Prisma.AuditEventWhereInput = {
      ...(query.category && { category: query.category }),
      ...(query.action && { action: query.action }),
      ...(query.actorId && { actorId: query.actorId }),
      ...(query.entityType && { entityType: query.entityType }),
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
