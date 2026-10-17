import { UserEntity } from '../entities/user.entity.js';
import type { CreateUserDto } from '../dto/create-user.dto.js';

export class UserMapper {
  static toEntity(raw: {
    id: string;
    email: string;
    name?: string | null;
    fullName?: string | null;
    authProvider?: string | null;
    status?: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): UserEntity {
    return new UserEntity({
      id: raw.id,
      email: raw.email,
      fullName: raw.name || raw.fullName || '',
      authProvider: raw.authProvider || 'local',
      status: raw.status || 'active',
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }

  static fromDtoToCreateInput(dto: CreateUserDto, id: string): {
    id: string;
    email: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    schoolId?: string;
  } {
    return {
      id,
      email: dto.email,
      name: dto.fullName,
      schoolId: dto.schoolId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
}
