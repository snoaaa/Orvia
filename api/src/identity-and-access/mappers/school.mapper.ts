import { SchoolEntity } from '../entities/school.entity.js';
import type { CreateSchoolDto } from '../dto/create-school.dto.js';

export class SchoolMapper {
  static toEntity(raw: {
    id: string;
    name: string;
    allowedDomains?: string | null;
    status?: string | null;
    settings?: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): SchoolEntity {
    let settingsObj: Record<string, unknown> | null = null;
    if (raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings)) {
      settingsObj = raw.settings as Record<string, unknown>;
    } else if (typeof raw.settings === 'string') {
      try {
        const parsed = JSON.parse(raw.settings);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          settingsObj = parsed as Record<string, unknown>;
        }
      } catch {
        settingsObj = null;
      }
    }

    return new SchoolEntity({
      id: raw.id,
      name: raw.name,
      allowedDomains: raw.allowedDomains || '',
      status: raw.status || 'active',
      settings: settingsObj,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }

  static fromDtoToCreateInput(dto: CreateSchoolDto, id: string): {
    id: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
  } {
    return {
      id,
      name: dto.name,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
}
