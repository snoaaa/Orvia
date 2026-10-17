import { SpaceEntity } from '../entities/space.entity.js';
import type { CreateSpaceDto } from '../dto/create-space.dto.js';

export class SpaceMapper {
  static toEntity(raw: {
    id: string;
    schoolId?: string | null;
    name: string;
    description?: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): SpaceEntity {
    return new SpaceEntity({
      id: raw.id,
      schoolId: raw.schoolId ?? null,
      name: raw.name,
      description: raw.description ?? '',
      language: 'en',
      privacy: 'public',
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }

  static fromDtoToCreateInput(dto: CreateSpaceDto, id: string, schoolId: string): {
    id: string;
    name: string;
    description: string | null;
    language: string;
    privacy: string;
    schoolId: string;
  } {
    return {
      id,
      name: dto.name,
      description: dto.description ?? null,
      language: dto.language ?? 'en',
      privacy: dto.privacy ?? 'public',
      schoolId,
    };
  }
}
