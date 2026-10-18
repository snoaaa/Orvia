import type { AuditEvent } from '@prisma/client';
import { AuditEventEntity } from '../entities/audit-event.entity.js';

export class AuditEventMapper {
  static toEntity(raw: AuditEvent): AuditEventEntity {
    return new AuditEventEntity({
      id: raw.id,
      seq: raw.seq.toString(),
      category: raw.category,
      action: raw.action,
      actorId: raw.actorId,
      actorRole: raw.actorRole,
      schoolId: raw.schoolId,
      entityType: raw.entityType,
      entityId: raw.entityId,
      ip: raw.ip,
      deviceId: raw.deviceId,
      details: (raw.details ?? {}) as Record<string, unknown>,
      prevHash: raw.prevHash,
      hash: raw.hash,
      createdAt: raw.createdAt,
    });
  }
}
