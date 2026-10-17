import { DeviceEntity } from '../entities/device.entity.js';
import type { RegisterDeviceDto } from '../dto/register-device.dto.js';

export class DeviceMapper {
  static toEntity(raw: Partial<DeviceEntity>): DeviceEntity {
    return new DeviceEntity({
      id: raw.id || '',
      userId: raw.userId || '',
      platform: raw.platform || 'android',
      lastSyncAt: raw.lastSyncAt || new Date(),
      createdAt: raw.createdAt || new Date(),
      updatedAt: raw.updatedAt || new Date(),
    });
  }

  static fromDtoToCreateInput(dto: RegisterDeviceDto, id: string): DeviceEntity {
    return new DeviceEntity({
      id,
      userId: dto.userId,
      platform: dto.platform,
      lastSyncAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}
