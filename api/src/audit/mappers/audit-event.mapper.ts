import { createHash } from 'node:crypto';
import { AuditEventEntity } from '../entities/audit-event.entity.js';
import type { CreateAuditEventDto } from '../dto/create-audit-event.dto.js';

export class AuditEventMapper {
  static toEntity(raw: Partial<AuditEventEntity>): AuditEventEntity {
    return new AuditEventEntity({
      id: raw.id || '',
      category: raw.category || 'SYSTEM',
      action: raw.action || 'UNKNOWN',
      actorId: raw.actorId ?? null,
      actorRole: raw.actorRole || 'SYSTEM',
      schoolId: raw.schoolId ?? null,
      entityType: raw.entityType || 'system',
      entityId: raw.entityId || '',
      ip: raw.ip || '127.0.0.1',
      deviceId: raw.deviceId ?? null,
      details: raw.details || {},
      prevHash: raw.prevHash || '0'.repeat(64),
      hash: raw.hash || '',
      createdAt: raw.createdAt || new Date(),
      updatedAt: raw.updatedAt || new Date(),
    });
  }

  static fromDtoToCreateInput(dto: CreateAuditEventDto, id: string, prevHash = '0'.repeat(64)): AuditEventEntity {
    const payload = JSON.stringify({
      id,
      category: dto.category,
      action: dto.action,
      actorId: dto.actorId,
      entityType: dto.entityType,
      entityId: dto.entityId,
      prevHash,
    });
    const hash = createHash('sha256').update(payload).digest('hex');

    return new AuditEventEntity({
      id,
      category: dto.category,
      action: dto.action,
      actorId: dto.actorId ?? null,
      actorRole: dto.actorRole,
      schoolId: dto.schoolId ?? null,
      entityType: dto.entityType,
      entityId: dto.entityId,
      ip: dto.ip,
      deviceId: dto.deviceId ?? null,
      details: dto.details || {},
      prevHash,
      hash,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}
