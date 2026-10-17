import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { UserStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import type { CreateRoleDto, CreateSchoolDto, CreateUserDto, UpdateUserDto } from '../dto/index.js';
import { RoleEntity, SchoolEntity, UserEntity } from '../entities/index.js';
import { SchoolMapper, UserMapper } from '../mappers/index.js';

@Injectable()
export class IdentityAndAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllUsers(): Promise<UserEntity[]> {
    const users = await this.prisma.user.findMany();
    return users.map((u) => UserMapper.toEntity(u));
  }

  async findUserById(id: string): Promise<UserEntity> {
    const user = await this.prisma.user.findUnique({
      where: { id },
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
        ...(dto.fullName && { fullName: dto.fullName }),
        ...(dto.status && { status: dto.status.toUpperCase() as UserStatus }),
      },
    });
    return UserMapper.toEntity(updated);
  }

  async findAllSchools(): Promise<SchoolEntity[]> {
    const schools = await this.prisma.school.findMany({
      include: { domains: true },
    });
    return schools.map((s) => SchoolMapper.toEntity(s));
  }

  async createSchool(dto: CreateSchoolDto): Promise<SchoolEntity> {
    const id = randomUUID();
    const domainList = (dto.allowedDomains || '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d.length > 0);

    const created = await this.prisma.school.create({
      data: {
        id,
        name: dto.name,
        allowedDomains: dto.allowedDomains || '',
        settings: (dto.settings as object) || null,
        domains: {
          create: domainList.map((domain) => ({ domain })),
        },
      },
      include: { domains: true },
    });

    return SchoolMapper.toEntity(created);
  }

  async findAllRoles(): Promise<RoleEntity[]> {
    const roles = await this.prisma.role.findMany();
    if (roles.length === 0) {
      return [
        new RoleEntity({ id: '1', name: 'ADMIN_PLATFORM', scope: 'platform', createdAt: new Date(), updatedAt: new Date() }),
        new RoleEntity({ id: '2', name: 'SCHOOL_ADMIN', scope: 'school', createdAt: new Date(), updatedAt: new Date() }),
        new RoleEntity({ id: '3', name: 'STAFF', scope: 'school', createdAt: new Date(), updatedAt: new Date() }),
        new RoleEntity({ id: '4', name: 'STUDENT', scope: 'group', createdAt: new Date(), updatedAt: new Date() }),
        new RoleEntity({ id: '5', name: 'PARENT_GUEST', scope: 'group', createdAt: new Date(), updatedAt: new Date() }),
      ];
    }
    return roles.map(
      (r) =>
        new RoleEntity({
          id: r.id,
          name: r.name,
          scope: r.scope,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }),
    );
  }

  async createRole(dto: CreateRoleDto): Promise<RoleEntity> {
    const id = randomUUID();
    const role = await this.prisma.role.create({
      data: {
        id,
        name: dto.name,
        scope: dto.scope,
      },
    });
    return new RoleEntity({
      id: role.id,
      name: role.name,
      scope: role.scope,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    });
  }
}
