import type { AuditEvent } from '@prisma/client';
import { AuditEventEntity } from '../entities/audit-event.entity.js';

/** Display names resolved by AuditQueryService (audit_events has no foreign keys). */
export interface AuditEventNames {
  actorName?: string | null;
  actorEmail?: string | null;
  schoolName?: string | null;
}

export class AuditEventMapper {
  static toEntity(raw: AuditEvent, names: AuditEventNames = {}): AuditEventEntity {
    return new AuditEventEntity({
      id: raw.id,
      seq: raw.seq.toString(),
      category: raw.category,
      action: raw.action,
      actorId: raw.actorId,
      actorName: names.actorName ?? null,
      actorEmail: names.actorEmail ?? null,
      actorRole: raw.actorRole,
      schoolId: raw.schoolId,
      schoolName: names.schoolName ?? null,
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
