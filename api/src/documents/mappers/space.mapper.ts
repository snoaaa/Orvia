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

  static fromDtoToCreateInput(dto: CreateSpaceDto, id: string): {
    id: string;
    name: string;
    description?: string;
    schoolId?: string;
    createdAt: Date;
    updatedAt: Date;
  } {
    return {
      id,
      name: dto.name,
      description: dto.description,
      schoolId: dto.schoolId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
}
