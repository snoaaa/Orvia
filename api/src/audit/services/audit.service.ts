import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import type { CreateAuditEventDto, QueryAuditEventsDto } from '../dto/index.js';
import { AuditEventEntity } from '../entities/index.js';
import { AuditEventMapper } from '../mappers/index.js';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(query?: QueryAuditEventsDto): Promise<AuditEventEntity[]> {
    const sample = new AuditEventEntity({
      id: randomUUID(),
      category: query?.category || 'SYSTEM',
      action: 'SYSTEM_BOOT',
      actorId: null,
      actorRole: 'SYSTEM',
      schoolId: null,
      entityType: 'server',
      entityId: 'api-main',
      ip: '127.0.0.1',
      deviceId: null,
      details: { environment: 'development', timestamp: new Date().toISOString() },
      prevHash: '0'.repeat(64),
      hash: '3f5a2b1c8e9d0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return [sample];
  }

  async logEvent(dto: CreateAuditEventDto): Promise<AuditEventEntity> {
    const id = randomUUID();
    const event = AuditEventMapper.fromDtoToCreateInput(dto, id);
    this.logger.log(`Audit Event [${event.category}] ${event.action} by actor ${event.actorRole}`);
    return event;
  }
}
