import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { UserStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AuditEvents } from '../../audit/builders/audit-events.builder.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { SYSTEM_AUDIT_CONTEXT, type AuditRequestContext } from '../../audit/utils/audit-request-context.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { CreateRoleDto, CreateSchoolDto, CreateUserDto, UpdateUserDto } from '../dto/index.js';
import { RoleEntity, SchoolEntity, UserEntity } from '../entities/index.js';
import { SchoolMapper, UserMapper } from '../mappers/index.js';

@Injectable()
export class IdentityAndAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAllUsers(): Promise<UserEntity[]> {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    });
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

  /** New users start as INVITED, so creating one is audited as identity_access/user_invited. */
  async createUser(dto: CreateUserDto, auditContext: AuditRequestContext = SYSTEM_AUDIT_CONTEXT): Promise<UserEntity> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      throw new ConflictException(`User with email '${dto.email}' already exists`);
    }

    const id = randomUUID();
    let passwordHash: string | null = null;
    if (dto.password) {
      passwordHash = await bcrypt.hash(dto.password, 12);
    }

    const data = UserMapper.fromDtoToCreateInput(dto, id, passwordHash);
    const created = await this.prisma.user.create({
      data,
    });
    // TODO(#9/#13): pass the inviting admin as `invitedBy` once the current user is known.
    await this.audit.record(
      AuditEvents.userInvited(
        { invitedUserId: created.id, email: created.email, schoolId: dto.schoolId ?? null },
        auditContext,
      ),
    );
    return UserMapper.toEntity(created);
  }

  async updateUser(id: string, dto: UpdateUserDto): Promise<UserEntity> {
    await this.findUserById(id);

    if (dto.email) {
      const normalizedEmail = dto.email.trim().toLowerCase();
      const existing = await this.prisma.user.findUnique({
        where: { email: normalizedEmail },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException(`Email '${dto.email}' is already in use`);
      }
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.email && { email: dto.email.trim().toLowerCase() }),
        ...(dto.fullName && { fullName: dto.fullName.trim() }),
        ...(dto.status && { status: dto.status.toUpperCase() as UserStatus }),
      },
    });
    return UserMapper.toEntity(updated);
  }

  async findAllSchools(): Promise<SchoolEntity[]> {
    const schools = await this.prisma.school.findMany({
      include: { domains: true },
      orderBy: { name: 'asc' },
    });
    return schools.map((s) => SchoolMapper.toEntity(s));
  }

  async createSchool(dto: CreateSchoolDto): Promise<SchoolEntity> {
    const id = randomUUID();
    const domainList = (dto.allowedDomains || '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d.length > 0);

    if (domainList.length > 0) {
      const existingDomain = await this.prisma.schoolDomain.findFirst({
        where: { domain: { in: domainList } },
      });
      if (existingDomain) {
        throw new ConflictException(`Domain '${existingDomain.domain}' is already assigned to another school`);
      }
    }

    const created = await this.prisma.school.create({
      data: {
        id,
        name: dto.name.trim(),
        allowedDomains: dto.allowedDomains ? dto.allowedDomains.trim() : '',
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
    const roles = await this.prisma.role.findMany({
      orderBy: { name: 'asc' },
    });
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
    const roleName = dto.name.trim().toUpperCase();
    const existing = await this.prisma.role.findUnique({
      where: { name: roleName },
    });
    if (existing) {
      throw new ConflictException(`Role '${roleName}' already exists`);
    }

    const id = randomUUID();
    const role = await this.prisma.role.create({
      data: {
        id,
        name: roleName,
        scope: dto.scope || 'school',
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
