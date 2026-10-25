import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { UserStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AuditEvents } from '../../audit/builders/audit-events.builder.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { SYSTEM_AUDIT_CONTEXT, type AuditRequestContext } from '../../audit/utils/audit-request-context.util.js';
import { SessionService } from '../../auth/services/session.service.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { assertSchoolAccess, schoolIdFilter, schoolsWithPermission } from '../../auth/utils/school-scope.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { CreateRoleDto, CreateSchoolDto, CreateUserDto, UpdateUserDto } from '../dto/index.js';
import {
  PermissionHolderEntity,
  PermissionOverviewEntity,
  RoleEntity,
  SchoolEntity,
  UserEntity,
} from '../entities/index.js';
import { SchoolMapper, UserMapper } from '../mappers/index.js';

@Injectable()
export class IdentityAndAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  /** Platform admins see everyone; others only users assigned to a school they can read users in. */
  async findAllUsers(actor: AuthenticatedUser): Promise<UserEntity[]> {
    const schoolId = schoolIdFilter(actor, 'users:read');
    const users = await this.prisma.user.findMany({
      where: schoolId ? { assignments: { some: { schoolId } } } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return users.map((u) => UserMapper.toEntity(u));
  }

  async findUserById(id: string, actor: AuthenticatedUser): Promise<UserEntity> {
    const user = await this.findUserInScope(id, actor, 'users:read');
    return UserMapper.toEntity(user);
  }

  /** Loads a user and throws 403 unless `actor` has `permission` in one of the user's schools. */
  private async findUserInScope(id: string, actor: AuthenticatedUser, permission: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { assignments: { select: { schoolId: true } } },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    assertSchoolAccess(actor, permission, user.assignments.map((a) => a.schoolId));
    return user;
  }

  /**
   * School-scoped admins must invite into one of their own schools. New users start as
   * INVITED, so creating one is audited as identity_access/user_invited.
   */
  async createUser(
    dto: CreateUserDto,
    actor: AuthenticatedUser,
    auditContext: AuditRequestContext = SYSTEM_AUDIT_CONTEXT,
  ): Promise<UserEntity> {
    if (dto.schoolId) {
      assertSchoolAccess(actor, 'users:invite', dto.schoolId);
    } else if (schoolsWithPermission(actor, 'users:invite') !== 'all') {
      throw new BadRequestException('schoolId is required: you can only invite users into your own school');
    }

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
    await this.audit.record(
      AuditEvents.userInvited(
        {
          invitedUserId: created.id,
          email: created.email,
          schoolId: dto.schoolId ?? null,
          invitedBy: { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
        },
        auditContext,
      ),
    );
    return UserMapper.toEntity(created);
  }

  /** Suspending a user also revokes all their sessions (#12), so no token keeps working. */
  async updateUser(
    id: string,
    dto: UpdateUserDto,
    actor: AuthenticatedUser,
    auditContext: AuditRequestContext = SYSTEM_AUDIT_CONTEXT,
  ): Promise<UserEntity> {
    const target = await this.findUserInScope(id, actor, 'users:update');
    if (dto.status) {
      // Suspending / reactivating is a separate right from editing a profile.
      assertSchoolAccess(actor, 'users:suspend', target.assignments.map((a) => a.schoolId));
    }

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
    if (updated.status === 'SUSPENDED') {
      await this.sessions.revokeAllForUser(
        id,
        'user_suspended',
        { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
        auditContext,
      );
    }
    return UserMapper.toEntity(updated);
  }

  async findAllSchools(actor: AuthenticatedUser): Promise<SchoolEntity[]> {
    const id = schoolIdFilter(actor, 'schools:read');
    const schools = await this.prisma.school.findMany({
      where: id ? { id } : undefined,
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

  /**
   * Every permission with the roles that grant it and the users holding it. Holders are
   * limited to the schools where `actor` may assign roles (all schools for platform admins).
   */
  async findPermissionOverview(actor: AuthenticatedUser, code?: string): Promise<PermissionOverviewEntity[]> {
    const schoolId = schoolIdFilter(actor, 'users:assign_role');
    const permissions = await this.prisma.permission.findMany({
      where: code ? { code } : undefined,
      orderBy: { code: 'asc' },
      include: {
        rolePermissions: {
          include: {
            role: {
              include: {
                assignments: {
                  where: schoolId ? { schoolId } : undefined,
                  include: { user: true, school: { select: { name: true } } },
                },
              },
            },
          },
        },
      },
    });
    if (code && permissions.length === 0) {
      throw new NotFoundException(`Permission '${code}' not found`);
    }

    return permissions.map(
      (p) =>
        new PermissionOverviewEntity({
          code: p.code,
          description: p.description,
          roles: p.rolePermissions.map((rp) => rp.role.name).sort(),
          holders: p.rolePermissions.flatMap((rp) =>
            rp.role.assignments.map(
              (a) =>
                new PermissionHolderEntity({
                  userId: a.user.id,
                  email: a.user.email,
                  fullName: a.user.fullName,
                  status: a.user.status,
                  role: rp.role.name,
                  schoolId: a.schoolId,
                  schoolName: a.school.name,
                }),
            ),
          ),
        }),
    );
  }
}
