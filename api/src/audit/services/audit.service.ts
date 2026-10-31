import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { AUDIT_CHAIN_HEAD_ID, AUDIT_GENESIS_HASH } from '../constants/audit-events.constants.js';
import type { RecordAuditEventInput } from '../dto/record-audit-event.input.js';
import { AuditEventEntity } from '../entities/index.js';
import { AuditEventMapper } from '../mappers/index.js';
import { computeAuditHash, type HashableAuditEvent } from '../utils/audit-hash.util.js';
import { redactSecrets } from '../utils/audit-redaction.util.js';
import { markRequestAudited } from '../utils/audit-request-context.util.js';

const MAX_COLUMN_LENGTH = 191;

/**
 * The only way to write to the audit trail. It has a single method on purpose:
 * events are appended, never updated or deleted. Reading and verification live in
 * AuditQueryService.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Appends one event to the hash chain and returns it.
   *
   * Concurrency: the single audit_chain_head row is locked (SELECT ... FOR UPDATE) for the
   * duration of the append, so writers queue up instead of racing for the same predecessor.
   * The lock is held by MySQL, so this also holds with several API instances.
   * Throws if the event cannot be stored; callers decide whether that blocks the action.
   */
  async record(input: RecordAuditEventInput): Promise<AuditEventEntity> {
    const details = redactSecrets({
      ...input.details,
      ...(input.context.userAgent ? { userAgent: input.context.userAgent } : {}),
    });

    try {
      const row = await this.prisma.$transaction(
        async (tx) => {
          const head = await lockChainHead(tx);
          const event: HashableAuditEvent = {
            id: randomUUID(),
            category: input.category,
            action: input.action,
            actorId: clip(input.actor.userId),
            actorRole: clip(input.actor.role),
            schoolId: clip(input.actor.schoolId),
            entityType: clip(input.entity?.type),
            entityId: clip(input.entity?.id),
            ip: clip(input.context.ip, 45),
            deviceId: clip(input.context.deviceId),
            details,
            // MySQL DATETIME(3) keeps milliseconds, so the stored value hashes identically.
            createdAt: new Date(),
            prevHash: head,
          };
          const hash = computeAuditHash(event);
          const created = await tx.auditEvent.create({
            data: { ...event, details: details as Prisma.InputJsonValue, hash },
          });
          await tx.auditChainHead.update({
            where: { id: AUDIT_CHAIN_HEAD_ID },
            data: { hash, eventSeq: created.seq },
          });
          return created;
        },
        { maxWait: 10_000, timeout: 15_000 },
      );
      if (input.context.request) markRequestAudited(input.context.request);
      return AuditEventMapper.toEntity(row);
    } catch (error) {
      this.logger.error(`Failed to record audit event ${input.category}/${input.action}`, error);
      throw error;
    }
  }
}

/** Locks the head row and returns the hash of the newest event (creating the row if missing). */
async function lockChainHead(tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<{ hash: string }[]>`
    SELECT hash FROM audit_chain_head WHERE id = ${AUDIT_CHAIN_HEAD_ID} FOR UPDATE`;
  if (rows.length > 0) return rows[0].hash;
  // Databases created with `prisma db push` have no seeded head row: start from the newest event.
  await tx.$executeRaw`
    INSERT IGNORE INTO audit_chain_head (id, hash, event_seq, updated_at)
    SELECT ${AUDIT_CHAIN_HEAD_ID},
           COALESCE((SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1), ${AUDIT_GENESIS_HASH}),
           COALESCE((SELECT MAX(seq) FROM audit_events), 0),
           NOW(3)`;
  return lockChainHead(tx);
}

function clip(value: string | null | undefined, max = MAX_COLUMN_LENGTH): string | null {
  if (value === null || value === undefined || value === '') return null;
  return value.length > max ? value.slice(0, max) : value;
}
