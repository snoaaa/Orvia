import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  CreateOfflineSelectionDto,
  RegisterDeviceDto,
  SubmitPendingQuestionDto,
  SyncChangesDto,
} from '../dto/index.js';
import {
  DeviceEntity,
  OfflineSelectionEntity,
  PendingQuestionEntity,
  SyncChangeEntity,
} from '../entities/index.js';
import { DeviceMapper } from '../mappers/index.js';

@Injectable()
export class MobileSyncService {
  constructor(private readonly prisma: PrismaService) {}

  async registerDevice(dto: RegisterDeviceDto): Promise<DeviceEntity> {
    const id = randomUUID();
    return DeviceMapper.fromDtoToCreateInput(dto, id);
  }

  async listDevices(userId: string): Promise<DeviceEntity[]> {
    return [
      new DeviceEntity({
        id: randomUUID(),
        userId,
        platform: 'android',
        lastSyncAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ];
  }

  async createOfflineSelection(dto: CreateOfflineSelectionDto): Promise<OfflineSelectionEntity> {
    return new OfflineSelectionEntity({
      id: randomUUID(),
      deviceId: dto.deviceId,
      spaceId: dto.spaceId || null,
      documentId: dto.documentId || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async queuePendingQuestion(dto: SubmitPendingQuestionDto): Promise<PendingQuestionEntity> {
    return new PendingQuestionEntity({
      id: randomUUID(),
      deviceId: dto.deviceId,
      conversationId: dto.conversationId,
      content: dto.content,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async processSync(dto: SyncChangesDto): Promise<{ synchronized: number; changes: SyncChangeEntity[] }> {
    const results: SyncChangeEntity[] = dto.changes.map(
      (item) =>
        new SyncChangeEntity({
          id: randomUUID(),
          userId: dto.userId,
          entityType: item.entityType,
          entityId: item.entityId,
          operation: item.operation,
          version: item.version,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
    );

    return {
      synchronized: results.length,
      changes: results,
    };
  }
}
