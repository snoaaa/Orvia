import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { AUDIT_GENESIS_HASH } from '../constants/audit-events.constants.js';
import type { RecordAuditEventInput } from '../dto/record-audit-event.input.js';
import { AuditEventEntity } from '../entities/index.js';
import { AuditEventMapper } from '../mappers/index.js';
import { computeAuditHash, type HashableAuditEvent } from '../utils/audit-hash.util.js';
import { redactSecrets } from '../utils/audit-redaction.util.js';
import { markRequestAudited } from '../utils/audit-request-context.util.js';

const MAX_CHAIN_RETRIES = 10;
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
   * Concurrency: prev_hash is UNIQUE, so if two events race for the same predecessor
   * one insert fails and is retried on top of the new head. No locks needed.
   * Throws if the event cannot be stored; callers decide whether that blocks the action.
   */
  async record(input: RecordAuditEventInput): Promise<AuditEventEntity> {
    const details = redactSecrets({
      ...input.details,
      ...(input.context.userAgent ? { userAgent: input.context.userAgent } : {}),
    });

    for (let attempt = 1; ; attempt++) {
      const head = await this.prisma.auditEvent.findFirst({
        orderBy: { seq: 'desc' },
        select: { hash: true },
      });

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
        prevHash: head?.hash ?? AUDIT_GENESIS_HASH,
      };
      const hash = computeAuditHash(event);

      try {
        const row = await this.prisma.auditEvent.create({
          data: { ...event, details: details as Prisma.InputJsonValue, hash },
        });
        if (input.context.request) markRequestAudited(input.context.request);
        return AuditEventMapper.toEntity(row);
      } catch (error) {
        const isChainRace =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!isChainRace || attempt >= MAX_CHAIN_RETRIES) {
          this.logger.error(`Failed to record audit event ${input.category}/${input.action}`, error);
          throw error;
        }
        // Random backoff so racing writers do not collide again on the next head.
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 20 * attempt));
      }
    }
  }
}

function clip(value: string | null | undefined, max = MAX_COLUMN_LENGTH): string | null {
  if (value === null || value === undefined || value === '') return null;
  return value.length > max ? value.slice(0, max) : value;
}
