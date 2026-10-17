import { SchoolEntity } from '../entities/school.entity.js';
import type { CreateSchoolDto } from '../dto/create-school.dto.js';

export class SchoolMapper {
  static toEntity(raw: {
    id: string;
    name: string;
    allowedDomains?: string | null;
    status?: string | null;
    settings?: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
  }): SchoolEntity {
    return new SchoolEntity({
      id: raw.id,
      name: raw.name,
      allowedDomains: raw.allowedDomains || '',
      status: raw.status || 'active',
      settings: raw.settings || null,
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
