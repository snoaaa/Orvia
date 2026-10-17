import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import type { CreateRoleDto, CreateSchoolDto, CreateUserDto, UpdateUserDto } from '../dto/index.js';
import { RoleEntity, SchoolEntity, UserEntity } from '../entities/index.js';
import { SchoolMapper, UserMapper } from '../mappers/index.js';

@Injectable()
export class IdentityAndAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllUsers(): Promise<UserEntity[]> {
    const users = await this.prisma.user.findMany({
      include: { school: true },
    });
    return users.map((u) => UserMapper.toEntity(u));
  }

  async findUserById(id: string): Promise<UserEntity> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { school: true },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return UserMapper.toEntity(user);
  }

  async createUser(dto: CreateUserDto): Promise<UserEntity> {
    const id = randomUUID();
    const data = UserMapper.fromDtoToCreateInput(dto, id);
    const created = await this.prisma.user.create({
      data,
    });
    return UserMapper.toEntity(created);
  }

  async updateUser(id: string, dto: UpdateUserDto): Promise<UserEntity> {
    await this.findUserById(id);
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.email && { email: dto.email }),
        ...(dto.fullName && { name: dto.fullName }),
        ...(dto.schoolId && { schoolId: dto.schoolId }),
      },
    });
    return UserMapper.toEntity(updated);
  }

  async findAllSchools(): Promise<SchoolEntity[]> {
    const schools = await this.prisma.school.findMany();
    return schools.map((s) => SchoolMapper.toEntity(s));
  }

  async createSchool(dto: CreateSchoolDto): Promise<SchoolEntity> {
    const id = randomUUID();
    const created = await this.prisma.school.create({
      data: SchoolMapper.fromDtoToCreateInput(dto, id),
    });
    return SchoolMapper.toEntity({
      ...created,
      allowedDomains: dto.allowedDomains,
      settings: dto.settings,
    });
  }

  async findAllRoles(): Promise<RoleEntity[]> {
    return [
      new RoleEntity({ id: '1', name: 'ADMIN_PLATFORM', scope: 'platform', createdAt: new Date(), updatedAt: new Date() }),
      new RoleEntity({ id: '2', name: 'SCHOOL_ADMIN', scope: 'school', createdAt: new Date(), updatedAt: new Date() }),
      new RoleEntity({ id: '3', name: 'STAFF', scope: 'school', createdAt: new Date(), updatedAt: new Date() }),
      new RoleEntity({ id: '4', name: 'STUDENT', scope: 'group', createdAt: new Date(), updatedAt: new Date() }),
      new RoleEntity({ id: '5', name: 'PARENT_GUEST', scope: 'group', createdAt: new Date(), updatedAt: new Date() }),
    ];
  }

  async createRole(dto: CreateRoleDto): Promise<RoleEntity> {
    return new RoleEntity({
      id: randomUUID(),
      name: dto.name,
      scope: dto.scope,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}
