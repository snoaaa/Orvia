import type { User, UserStatus } from '@prisma/client';
import type { CreateUserDto } from '../dto/create-user.dto.js';
import { UserEntity } from '../entities/user.entity.js';

export class UserMapper {
  static toEntity(raw: User): UserEntity {
    return new UserEntity({
      id: raw.id,
      email: raw.email,
      fullName: raw.fullName,
      authProvider: raw.authProvider,
      status: raw.status,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }

  static fromDtoToCreateInput(dto: CreateUserDto, id: string, passwordHash?: string | null): {
    id: string;
    email: string;
    fullName: string;
    authProvider: string;
    passwordHash: string | null;
    status: UserStatus;
  } {
    return {
      id,
      email: dto.email.trim().toLowerCase(),
      fullName: dto.fullName.trim(),
      authProvider: dto.authProvider || 'local',
      passwordHash: passwordHash ?? null,
      status: 'INVITED',
    };
  }
}
