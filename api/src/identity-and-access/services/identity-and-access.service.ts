import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma, UserStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AuditEvents } from '../../audit/builders/audit-events.builder.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { SYSTEM_AUDIT_CONTEXT, type AuditRequestContext } from '../../audit/utils/audit-request-context.util.js';
import { SessionService } from '../../auth/services/session.service.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { assertSchoolAccess, schoolIdFilter, schoolsWithPermission } from '../../auth/utils/school-scope.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { CreateRoleDto, CreateSchoolDto, UpdateSchoolDto, ListSchoolsQueryDto, CreateUserDto, InviteUserDto, UpdateUserDto } from '../dto/index.js';
import {
  PaginatedSchoolsEntity,
  PermissionHolderEntity,
  PermissionOverviewEntity,
  RoleEntity,
  SchoolEntity,
  UserEntity,
} from '../entities/index.js';
import { SchoolMapper, UserMapper } from '../mappers/index.js';
import { DomainValidationService } from './domain-validation.service.js';

/** Role given to invited users when none is specified. */
const DEFAULT_INVITE_ROLE = 'STUDENT';

@Injectable()
export class IdentityAndAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly domainValidation: DomainValidationService,
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
      const domainValidation = await this.domainValidation.validateDomainForSchool(dto.email, dto.schoolId);
      if (domainValidation.allowed === false) {
        throw new BadRequestException(`Email domain '@${domainValidation.domain}' is not allowed for this school`);
      }
    } else if (schoolsWithPermission(actor, 'users:invite') !== 'all') {
      throw new BadRequestException('schoolId is required: you can only invite users into your own school');
    }
    const role = dto.schoolId ? await this.resolveInviteRole(dto.schoolId, dto.role, actor) : null;
    if (!dto.schoolId && dto.role) {
      throw new BadRequestException('role requires schoolId');
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
    // User and school assignment together: an invited user must never exist without the
    // school they were invited into, or their school admin could not see them.
    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data });
      if (dto.schoolId && role) {
        await tx.userAssignment.create({ data: { userId: user.id, schoolId: dto.schoolId, roleId: role.id } });
      }
      return user;
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

  /**
   * Invites a new user into a school without a password (Issue #9).
   *
   * Enforces:
   *  - Role & school access assertion (school admin can only invite into their assigned school).
   *  - Domain validation against the school's configured domains in school_domains.
   *    Schools with zero configured domains allow any email domain.
   *  - Duplicate email rejection across the entire platform with 409 Conflict.
   *  - Creates user with status INVITED, authProvider = 'google', and no password.
   *  - Creates user_assignments record in a single atomic transaction.
   *  - Records tamper-evident audit event identity_access/user_invited.
   */
  async inviteUser(
    dto: InviteUserDto,
    actor: AuthenticatedUser,
    auditContext: AuditRequestContext = SYSTEM_AUDIT_CONTEXT,
  ): Promise<UserEntity> {
    if (dto.schoolId) {
      assertSchoolAccess(actor, 'users:invite', dto.schoolId);
      const domainValidation = await this.domainValidation.validateDomainForSchool(dto.email, dto.schoolId);
      if (domainValidation.allowed === false) {
        throw new BadRequestException(`Email domain '@${domainValidation.domain}' is not allowed for this school`);
      }
    } else if (schoolsWithPermission(actor, 'users:invite') !== 'all') {
      throw new BadRequestException('schoolId is required: you can only invite users into your own school');
    }

    const role = dto.schoolId ? await this.resolveInviteRole(dto.schoolId, dto.role, actor) : null;
    if (!dto.schoolId && dto.role) {
      throw new BadRequestException('role requires schoolId');
    }

    const normalizedEmail = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      throw new ConflictException(`User with email '${dto.email}' already exists`);
    }

    const id = randomUUID();
    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id,
          email: normalizedEmail,
          fullName: dto.fullName.trim(),
          authProvider: 'google',
          passwordHash: null,
          status: 'INVITED',
        },
      });
      if (dto.schoolId && role) {
        await tx.userAssignment.create({ data: { userId: user.id, schoolId: dto.schoolId, roleId: role.id } });
      }
      return user;
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


  /**
   * Role given to an invited user in `schoolId` (default STUDENT, the least-privileged school
   * member). The school must exist; a platform-scoped role (e.g. PLATFORM_ADMIN) can only be
   * given by someone who assigns roles platform-wide.
   */
  private async resolveInviteRole(schoolId: string, roleName: string | undefined, actor: AuthenticatedUser) {
    const school = await this.prisma.school.findUnique({ where: { id: schoolId }, select: { id: true } });
    if (!school) {
      throw new NotFoundException(`School with ID ${schoolId} not found`);
    }
    const name = (roleName ?? DEFAULT_INVITE_ROLE).trim().toUpperCase();
    const role = await this.prisma.role.findUnique({ where: { name } });
    if (!role) {
      throw new BadRequestException(`Unknown role '${name}'`);
    }
    if (role.scope === 'platform' && schoolsWithPermission(actor, 'users:assign_role') !== 'all') {
      throw new ForbiddenException(`Only a platform administrator can assign the ${role.name} role`);
    }
    return role;
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

  /**
   * List schools with pagination and status filter (Issue #29).
   *
   * Scoping:
   *  - Platform administrators see all schools.
   *  - School administrators only see their own assigned schools.
   *  - Others cannot read schools (blocked by guard).
   */
  async findAllSchools(
    actor: AuthenticatedUser,
    query?: ListSchoolsQueryDto,
  ): Promise<PaginatedSchoolsEntity> {
    const page = Math.max(1, query?.page ?? 1);
    const limit = Math.min(100, Math.max(1, query?.limit ?? 10));
    const skip = (page - 1) * limit;

    const allowedSchools = schoolIdFilter(actor, 'schools:read');

    const where: Prisma.SchoolWhereInput = {
      ...(allowedSchools ? { id: allowedSchools } : {}),
      ...(query?.status ? { status: query.status.trim() } : {}),
      ...(query?.search
        ? {
            name: {
              contains: query.search.trim(),
            },
          }
        : {}),
    };

    const [total, schools] = await Promise.all([
      this.prisma.school.count({ where }),
      this.prisma.school.findMany({
        where,
        include: { domains: true },
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return new PaginatedSchoolsEntity({
      data: schools.map((s) => SchoolMapper.toEntity(s)),
      total,
      page,
      limit,
      totalPages,
    });
  }

  /**
   * Get a single school by ID (Issue #29).
   *
   * Scoping:
   *  - Platform administrator may read any school.
   *  - School administrator can only read their own school (throws 403 Forbidden).
   *  - Throws 404 NotFoundException if the school does not exist.
   */
  async findSchoolById(id: string, actor: AuthenticatedUser): Promise<SchoolEntity> {
    assertSchoolAccess(actor, 'schools:read', id);
    const school = await this.prisma.school.findUnique({
      where: { id },
      include: { domains: true },
    });
    if (!school) {
      throw new NotFoundException(`School with ID '${id}' not found`);
    }
    return SchoolMapper.toEntity(school);
  }

  /**
   * Update school parameters (name, settings) (Issue #30).
   *
   * Scoping:
   *  - Platform administrator may edit any school.
   *  - School administrator can only edit their own school (throws 403 Forbidden).
   *  - Rejects duplicate names across institutions with 409 Conflict.
   *  - Prisma @updatedAt automatically updates updated_at timestamp.
   */
  async updateSchool(
    id: string,
    dto: UpdateSchoolDto,
    actor: AuthenticatedUser,
    _auditContext: AuditRequestContext = SYSTEM_AUDIT_CONTEXT,
  ): Promise<SchoolEntity> {
    assertSchoolAccess(actor, 'schools:update', id);

    const school = await this.prisma.school.findUnique({
      where: { id },
    });
    if (!school) {
      throw new NotFoundException(`School with ID '${id}' not found`);
    }

    if (dto.name !== undefined) {
      const trimmedName = dto.name.trim();
      if (!trimmedName) {
        throw new BadRequestException('School name cannot be empty');
      }

      const duplicate = await this.prisma.school.findFirst({
        where: { name: trimmedName },
      });
      if (duplicate && duplicate.id !== id) {
        throw new ConflictException(`School with name '${trimmedName}' already exists`);
      }
    }

    const updated = await this.prisma.school.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.settings !== undefined ? { settings: dto.settings as object } : {}),
      },
      include: { domains: true },
    });

    return SchoolMapper.toEntity(updated);
  }

  /**
   * Deactivate a school without deleting its data (Issue #31).
   *
   * Enforces:
   *  - Platform administrator restriction (actor must hold schools:delete platform-wide).
   *  - School administrators and other roles are forbidden (throws 403 Forbidden).
   *  - Soft status transition to 'deactivated': preserves all data (domains, users, groups, spaces).
   *  - Idempotent: succeeds even if school is already deactivated.
   */
  async deactivateSchool(
    id: string,
    actor?: AuthenticatedUser,
    _auditContext: AuditRequestContext = SYSTEM_AUDIT_CONTEXT,
  ): Promise<SchoolEntity> {
    if (actor && schoolsWithPermission(actor, 'schools:delete') !== 'all') {
      throw new ForbiddenException('Only platform administrators may deactivate schools');
    }

    const school = await this.prisma.school.findUnique({
      where: { id },
    });
    if (!school) {
      throw new NotFoundException(`School with ID '${id}' not found`);
    }

    const updated = await this.prisma.school.update({
      where: { id },
      data: { status: 'deactivated' },
      include: { domains: true },
    });

    return SchoolMapper.toEntity(updated);
  }

  /**
   * Reactivate a school (Issue #31).
   *
   * Enforces:
   *  - Platform administrator restriction (actor must hold schools:delete platform-wide).
   *  - School administrators and other roles are forbidden (throws 403 Forbidden).
   *  - Soft status transition to 'active': restores sign-in and refresh access for users.
   *  - Idempotent: succeeds even if school is already active.
   */
  async reactivateSchool(
    id: string,
    actor?: AuthenticatedUser,
    _auditContext: AuditRequestContext = SYSTEM_AUDIT_CONTEXT,
  ): Promise<SchoolEntity> {
    if (actor && schoolsWithPermission(actor, 'schools:delete') !== 'all') {
      throw new ForbiddenException('Only platform administrators may reactivate schools');
    }

    const school = await this.prisma.school.findUnique({
      where: { id },
    });
    if (!school) {
      throw new NotFoundException(`School with ID '${id}' not found`);
    }

    const updated = await this.prisma.school.update({
      where: { id },
      data: { status: 'active' },
      include: { domains: true },
    });

    return SchoolMapper.toEntity(updated);
  }

  /**
   * Register/create a new school (Issue #27).
   *
   * Enforces:
   *  - Platform administrator restriction (actor must hold schools:create platform-wide).
   *  - Required fields and non-empty name.
   *  - Unique school name validation: rejects duplicates with 409 Conflict.
   *  - Default status 'active'.
   *  - Optional domain validation against existing school domains if domains are provided.
   */
  async createSchool(
    dto: CreateSchoolDto,
    actor?: AuthenticatedUser,
    _auditContext: AuditRequestContext = SYSTEM_AUDIT_CONTEXT,
  ): Promise<SchoolEntity> {
    if (actor && schoolsWithPermission(actor, 'schools:create') !== 'all') {
      throw new ForbiddenException('Only a platform administrator can create a school');
    }

    const trimmedName = dto.name?.trim();
    if (!trimmedName) {
      throw new BadRequestException('School name is required and cannot be empty');
    }

    const existingByName = await this.prisma.school.findFirst({
      where: { name: trimmedName },
    });
    if (existingByName) {
      throw new ConflictException(`School with name '${trimmedName}' already exists`);
    }

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

    const status = dto.status?.trim() || 'active';

    const created = await this.prisma.school.create({
      data: {
        id,
        name: trimmedName,
        status,
        allowedDomains: dto.allowedDomains ? dto.allowedDomains.trim() : '',
        settings: (dto.settings as object) || null,
        domains:
          domainList.length > 0
            ? {
                create: domainList.map((domain) => ({ domain })),
              }
            : undefined,
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
