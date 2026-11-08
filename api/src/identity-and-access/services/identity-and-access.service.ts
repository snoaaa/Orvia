import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { UserStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import argon2 from 'argon2';
import { AuditEvents } from '../../audit/builders/audit-events.builder.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { SYSTEM_AUDIT_CONTEXT, type AuditRequestContext } from '../../audit/utils/audit-request-context.util.js';
import { ActiveSessionEntity } from '../../auth/entities/index.js';
import { SessionService } from '../../auth/services/session.service.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { isAdminRole, isBaseRoleName } from '../../auth/utils/admin-role.util.js';
import { assertSchoolAccess, schoolIdFilter, schoolsWithPermission } from '../../auth/utils/school-scope.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { AssignRoleDto, CreateRoleDto, UpdateRoleDto, CreateSchoolDto, UpdateSchoolDto, ListSchoolsQueryDto, ListUsersQueryDto, CreateUserDto, InviteUserDto, QueryPermissionOverviewDto, UpdateUserDto, UpdateUserProfileDto } from '../dto/index.js';
import {
  PaginatedSchoolsEntity,
  PaginatedUsersEntity,
  PermissionHolderEntity,
  PermissionOverviewEntity,
  RoleEntity,
  SchoolEntity,
  UserDetailEntity,
  UserEntity,
  UserListItemEntity,
} from '../entities/index.js';
import { SchoolMapper, UserMapper } from '../mappers/index.js';
import { DomainValidationService } from './domain-validation.service.js';

/** Role given to invited users when none is specified. */
const DEFAULT_INVITE_ROLE = 'STUDENT';

interface RoleWithPermissions {
  scope: string;
  rolePermissions?: ReadonlyArray<{ permission: { code: string } }>;
}

/** Admin-ness of a role row (see `auth/utils/admin-role.util.ts`); a missing include counts as none. */
function roleGrantsAdmin(role: RoleWithPermissions): boolean {
  return isAdminRole({
    scope: role.scope,
    permissions: role.rolePermissions?.map((rp) => rp.permission.code) ?? [],
  });
}

@Injectable()
export class IdentityAndAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly domainValidation: DomainValidationService,
  ) {}

  /**
   * GET /users (#38): search, filters, pagination and sorting, scoped to the admin's schools.
   *
   * - School admins only get users with an assignment in one of their schools; filtering on another
   *   school or one of its groups is 403. Users without any school are visible to platform admins only.
   * - `schoolId`, `role` and `groupId` must match the SAME assignment ("STAFF in school A"); a group
   *   can also match through a group membership (group_members).
   * - Each user's `assignments` only lists the schools the admin can see.
   */
  async listUsers(actor: AuthenticatedUser, query: ListUsersQueryDto = {}): Promise<PaginatedUsersEntity> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const scope = schoolIdFilter(actor, 'users:read');
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? (sortBy === 'createdAt' ? 'desc' : 'asc');

    if (query.schoolId) {
      assertSchoolAccess(actor, 'users:read', query.schoolId);
    }
    if (query.groupId) {
      const group = await this.prisma.group.findUnique({ where: { id: query.groupId }, select: { schoolId: true } });
      if (!group) {
        throw new NotFoundException(`Group with ID ${query.groupId} not found`);
      }
      assertSchoolAccess(actor, 'users:read', group.schoolId);
    }
    if (query.role && !(await this.prisma.role.findUnique({ where: { name: query.role }, select: { id: true } }))) {
      throw new BadRequestException(`Unknown role '${query.role}'`);
    }

    // Conditions one assignment must meet; also confined to the admin's schools when scoped.
    const assignment: Prisma.UserAssignmentWhereInput = {
      ...(query.schoolId ? { schoolId: query.schoolId } : scope ? { schoolId: scope } : {}),
      ...(query.role && { role: { name: query.role } }),
    };
    const filters: Prisma.UserWhereInput[] = [];
    if (scope) filters.push({ assignments: { some: { schoolId: scope } } });
    if (query.status) filters.push({ status: query.status });
    if (query.search) {
      // MySQL's default collation (utf8mb4_unicode_ci) makes `contains` case-insensitive.
      filters.push({ OR: [{ fullName: { contains: query.search } }, { email: { contains: query.search } }] });
    }
    if (query.groupId) {
      filters.push({
        OR: [
          { assignments: { some: { ...assignment, groupId: query.groupId } } },
          {
            AND: [
              { groupMemberships: { some: { groupId: query.groupId } } },
              { assignments: { some: assignment } },
            ],
          },
        ],
      });
    } else if (query.schoolId || query.role) {
      filters.push({ assignments: { some: assignment } });
    }
    const where: Prisma.UserWhereInput = filters.length > 0 ? { AND: filters } : {};

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        // Secondary sort on id keeps pagination stable when values are equal.
        orderBy: [{ [sortBy]: sortOrder }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          assignments: {
            where: scope ? { schoolId: scope } : undefined,
            orderBy: { createdAt: 'asc' },
            include: {
              school: { select: { name: true } },
              role: { select: { name: true } },
              group: { select: { name: true } },
            },
          },
        },
      }),
    ]);

    return new PaginatedUsersEntity({
      data: users.map(
        (u) =>
          new UserListItemEntity({
            id: u.id,
            email: u.email,
            fullName: u.fullName,
            authProvider: u.authProvider,
            status: u.status,
            assignments: u.assignments.map((a) => ({
              schoolId: a.schoolId,
              schoolName: a.school.name,
              role: a.role.name,
              groupId: a.groupId,
              groupName: a.group?.name ?? null,
            })),
            createdAt: u.createdAt,
            updatedAt: u.updatedAt,
          }),
      ),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    });
  }

  /** GET /users/:id (#39): 403 outside the admin's schools; assignments and groups are limited to those schools. */
  async getUserDetail(id: string, actor: AuthenticatedUser): Promise<UserDetailEntity> {
    const scope = schoolIdFilter(actor, 'users:read');

    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        assignments: {
          where: scope ? { schoolId: scope } : undefined,
          orderBy: { createdAt: 'asc' },
          include: {
            school: { select: { name: true } },
            role: { select: { name: true } },
            group: { select: { name: true } },
          },
        },
        groupMemberships: {
          where: scope ? { group: { schoolId: scope } } : undefined,
          orderBy: { createdAt: 'asc' },
          include: { group: { include: { school: { select: { name: true } } } } },
        },
      },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    // For a scoped admin only assignments in their schools were loaded: none means outside their scope.
    assertSchoolAccess(actor, 'users:read', user.assignments.map((a) => a.schoolId));
    const sessions = await this.sessions.listActive(id);

    return new UserDetailEntity({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      authProvider: user.authProvider,
      status: user.status,
      hasPassword: user.passwordHash !== null,
      googleLinked: user.googleSub !== null,
      assignments: user.assignments.map((a) => ({
        schoolId: a.schoolId,
        schoolName: a.school.name,
        role: a.role.name,
        groupId: a.groupId,
        groupName: a.group?.name ?? null,
      })),
      groups: user.groupMemberships.map((m) => ({
        groupId: m.groupId,
        groupName: m.group.name,
        groupType: m.group.type,
        schoolId: m.group.schoolId,
        schoolName: m.group.school.name,
      })),
      sessions: sessions.map((s) => ActiveSessionEntity.from(s, actor.sessionId)),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
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
      passwordHash = await argon2.hash(dto.password);
    }

    const isAdmin = role ? roleGrantsAdmin(role) : false;
    let setupToken: string | null = null;
    let setupTokenExpiresAt: Date | null = null;
    if (isAdmin && !passwordHash) {
      setupToken = randomBytes(32).toString('hex');
      setupTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    }

    const data = UserMapper.fromDtoToCreateInput(dto, id, passwordHash);
    // User and school assignment together: an invited user must never exist without the
    // school they were invited into, or their school admin could not see them.
    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data });
      if (dto.schoolId && role) {
        await tx.userAssignment.create({ data: { userId: user.id, schoolId: dto.schoolId, roleId: role.id } });
      }
      if (isAdmin && setupToken && setupTokenExpiresAt) {
        const tokenHash = createHash('sha256').update(setupToken).digest('hex');
        await tx.passwordSetupToken.create({
          data: {
            userId: user.id,
            tokenHash,
            expiresAt: setupTokenExpiresAt,
          },
        });
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
    const isAdmin = role ? roleGrantsAdmin(role) : false;
    const authProvider = isAdmin ? 'local' : 'google';
    let setupToken: string | null = null;
    let setupTokenExpiresAt: Date | null = null;
    if (isAdmin) {
      setupToken = randomBytes(32).toString('hex');
      setupTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id,
          email: normalizedEmail,
          fullName: dto.fullName.trim(),
          authProvider,
          passwordHash: null,
          status: 'INVITED',
        },
      });
      if (dto.schoolId && role) {
        await tx.userAssignment.create({ data: { userId: user.id, schoolId: dto.schoolId, roleId: role.id } });
      }
      if (isAdmin && setupToken && setupTokenExpiresAt) {
        const tokenHash = createHash('sha256').update(setupToken).digest('hex');
        await tx.passwordSetupToken.create({
          data: {
            userId: user.id,
            tokenHash,
            expiresAt: setupTokenExpiresAt,
          },
        });
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

    const entity = UserMapper.toEntity(created);
    if (isAdmin && setupToken) {
      entity.setupToken = setupToken;
      entity.setupTokenExpiresAt = setupTokenExpiresAt;
    }
    return entity;
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
    const role = await this.prisma.role.findUnique({
      where: { name },
      include: { rolePermissions: { select: { permission: { select: { code: true } } } } },
    });
    if (!role) {
      throw new BadRequestException(`Unknown role '${name}'`);
    }
    if (role.scope === 'platform' && schoolsWithPermission(actor, 'users:assign_role') !== 'all') {
      throw new ForbiddenException(`Only a platform administrator can assign the ${role.name} role`);
    }
    return role;
  }

  /** Suspending a user also revokes all their sessions (#12), so no token keeps working. */
  /** PATCH /users/:id (#40): full name and email only. */
  async updateUserProfile(
    id: string,
    dto: UpdateUserProfileDto,
    actor: AuthenticatedUser,
    auditContext: AuditRequestContext = SYSTEM_AUDIT_CONTEXT,
  ): Promise<UserEntity> {
    if (dto.fullName === undefined && dto.email === undefined) {
      throw new BadRequestException('Nothing to update: provide fullName or email');
    }
    return this.updateUser(id, dto, actor, auditContext);
  }

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

    // Nothing would change: skip the write so updated_at only moves on a real edit.
    const sameName = dto.fullName === undefined || dto.fullName.trim() === target.fullName;
    const sameEmail = dto.email === undefined || dto.email.trim().toLowerCase() === target.email;
    if (sameName && sameEmail && !dto.status) {
      return UserMapper.toEntity(target);
    }

    if (dto.email) {
      const normalizedEmail = dto.email.trim().toLowerCase();
      const existing = await this.prisma.user.findUnique({
        where: { email: normalizedEmail },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException(`Email '${dto.email}' is already in use`);
      }
      // Only a new address is checked: renaming a user must not fail because of an older email.
      const schoolIds = target.assignments.map((a) => a.schoolId);
      if (normalizedEmail !== target.email && schoolIds.length > 0) {
        const { allowed } = await this.domainValidation.validateDomainForUser(normalizedEmail, schoolIds);
        if (!allowed) {
          throw new BadRequestException(
            `Email domain '@${this.domainValidation.extractDomain(normalizedEmail)}' is not allowed for this user's school`,
          );
        }
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
   * Creates or replaces a user's role in one school (role reassignment).
   *
   * Enforces:
   *  - `users:assign_role` in the target school (platform admins may act on any school).
   *  - The school and the role must exist (404 / 400).
   *  - A platform-scoped role can only be granted by someone who assigns roles platform-wide (403).
   *  - Idempotent: re-assigning the role the user already holds changes nothing and records nothing.
   *  - Tamper-evident audit event `identity_access/role_assigned` with the previous role.
   *
   * The user's other school assignments are untouched.
   */
  async assignRole(
    userId: string,
    dto: AssignRoleDto,
    actor: AuthenticatedUser,
    auditContext: AuditRequestContext = SYSTEM_AUDIT_CONTEXT,
  ): Promise<UserEntity> {
    const actorScope = schoolsWithPermission(actor, 'users:assign_role');
    if (actorScope !== 'all') {
      assertSchoolAccess(actor, 'users:assign_role', dto.schoolId);
    }

    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { assignments: { include: { role: true } } },
    });
    if (!target) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const school = await this.prisma.school.findUnique({
      where: { id: dto.schoolId },
      select: { id: true },
    });
    if (!school) {
      throw new NotFoundException(`School with ID ${dto.schoolId} not found`);
    }

    const roleName = dto.role.trim().toUpperCase();
    const role = await this.prisma.role.findUnique({
      where: { name: roleName },
      include: { rolePermissions: { select: { permission: { select: { code: true } } } } },
    });
    if (!role) {
      throw new BadRequestException(`Unknown role '${roleName}'`);
    }
    if (role.scope === 'platform' && actorScope !== 'all') {
      throw new ForbiddenException(`Only a platform administrator can assign the ${role.name} role`);
    }

    const existing = target.assignments.find((a) => a.schoolId === dto.schoolId);
    if (existing?.roleId === role.id) {
      return UserMapper.toEntity(target);
    }

    if (existing) {
      await this.prisma.userAssignment.update({ where: { id: existing.id }, data: { roleId: role.id } });
    } else {
      await this.prisma.userAssignment.create({
        data: { userId: target.id, schoolId: dto.schoolId, roleId: role.id },
      });
    }

    await this.audit.record(
      AuditEvents.roleAssigned(
        {
          userId: target.id,
          email: target.email,
          schoolId: dto.schoolId,
          role: role.name,
          previousRole: existing?.role.name ?? null,
          assignedBy: { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
        },
        auditContext,
      ),
    );

    return UserMapper.toEntity(target);
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
   * Update school parameters (name, settings, allowed email domains) (Issue #30).
   *
   * Scoping:
   *  - Platform administrator may edit any school.
   *  - School administrator can only edit their own school (throws 403 Forbidden).
   *  - Rejects duplicate names across institutions with 409 Conflict.
   *  - `allowedDomains` replaces the school's `school_domains` rows, which is what the email-domain
   *    validation reads. An empty value clears them ("the school restricts nothing"); a domain
   *    already used by another school answers 409.
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

    // `undefined` = leave the domains untouched. `''` = clear them.
    let domainList: string[] | null = null;
    if (dto.allowedDomains !== undefined) {
      domainList = [
        ...new Set(
          dto.allowedDomains
            .split(',')
            .map((domain) => domain.trim().toLowerCase())
            .filter((domain) => domain.length > 0),
        ),
      ];
      if (domainList.length > 0) {
        const taken = await this.prisma.schoolDomain.findFirst({
          where: { domain: { in: domainList }, schoolId: { not: id } },
        });
        if (taken) {
          throw new ConflictException(`Domain '${taken.domain}' is already assigned to another school`);
        }
      }
    }

    const data = {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.settings !== undefined ? { settings: dto.settings as object } : {}),
      ...(domainList !== null ? { allowedDomains: domainList.join(',') } : {}),
    };

    // Only pay for a transaction when the domain rows actually change.
    const updated =
      domainList === null
        ? await this.prisma.school.update({ where: { id }, data, include: { domains: true } })
        : await this.prisma.$transaction(async (tx) => {
            await tx.schoolDomain.deleteMany({ where: { schoolId: id } });
            if (domainList.length > 0) {
              await tx.schoolDomain.createMany({
                data: domainList.map((domain) => ({ schoolId: id, domain })),
              });
            }
            return tx.school.update({ where: { id }, data, include: { domains: true } });
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
      include: {
        rolePermissions: {
          include: { permission: true },
        },
        _count: {
          select: { assignments: true },
        },
      },
    });
    return roles.map(
      (r) =>
        new RoleEntity({
          id: r.id,
          name: r.name,
          scope: r.scope,
          permissions: r.rolePermissions.map((rp) => rp.permission.code).sort(),
          assignedUsersCount: r._count.assignments,
          isBase: isBaseRoleName(r.name),
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }),
    );
  }

  async findRoleById(id: string): Promise<RoleEntity> {
    const role = await this.prisma.role.findFirst({
      where: { OR: [{ id }, { name: id.trim().toUpperCase() }] },
      include: {
        rolePermissions: {
          include: { permission: true },
        },
        _count: {
          select: { assignments: true },
        },
      },
    });
    if (!role) {
      throw new NotFoundException(`Role '${id}' not found`);
    }
    return new RoleEntity({
      id: role.id,
      name: role.name,
      scope: role.scope,
      permissions: role.rolePermissions.map((rp) => rp.permission.code).sort(),
      assignedUsersCount: role._count.assignments,
      isBase: isBaseRoleName(role.name),
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    });
  }

  async createRole(dto: CreateRoleDto): Promise<RoleEntity> {
    const roleName = dto.name.trim().toUpperCase();
    if (isBaseRoleName(roleName)) {
      throw new BadRequestException(`Role name '${roleName}' is reserved for system base roles`);
    }
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

    if (dto.permissions && dto.permissions.length > 0) {
      const perms = await this.prisma.permission.findMany({
        where: { code: { in: dto.permissions } },
      });
      if (perms.length > 0) {
        await this.prisma.rolePermission.createMany({
          data: perms.map((p) => ({
            roleId: role.id,
            permissionId: p.id,
          })),
          skipDuplicates: true,
        });
      }
    }

    return this.findRoleById(role.id);
  }

  async updateRole(id: string, dto: UpdateRoleDto): Promise<RoleEntity> {
    const role = await this.prisma.role.findFirst({
      where: { OR: [{ id }, { name: id.trim().toUpperCase() }] },
    });
    if (!role) {
      throw new NotFoundException(`Role '${id}' not found`);
    }
    if (isBaseRoleName(role.name)) {
      throw new BadRequestException('System base roles cannot be modified');
    }

    let nextName = role.name;
    if (dto.name && dto.name.trim()) {
      nextName = dto.name.trim().toUpperCase();
      if (isBaseRoleName(nextName)) {
        throw new BadRequestException(`Role name '${nextName}' is reserved for system base roles`);
      }
      if (nextName !== role.name) {
        const existing = await this.prisma.role.findUnique({ where: { name: nextName } });
        if (existing && existing.id !== role.id) {
          throw new ConflictException(`Role '${nextName}' already exists`);
        }
      }
    }

    await this.prisma.role.update({
      where: { id: role.id },
      data: {
        name: nextName,
        ...(dto.scope ? { scope: dto.scope } : {}),
      },
    });

    if (dto.permissions) {
      await this.prisma.rolePermission.deleteMany({
        where: { roleId: role.id },
      });
      if (dto.permissions.length > 0) {
        const perms = await this.prisma.permission.findMany({
          where: { code: { in: dto.permissions } },
        });
        if (perms.length > 0) {
          await this.prisma.rolePermission.createMany({
            data: perms.map((p) => ({
              roleId: role.id,
              permissionId: p.id,
            })),
            skipDuplicates: true,
          });
        }
      }
    }

    return this.findRoleById(role.id);
  }

  async deleteRole(id: string): Promise<{ success: boolean; message: string }> {
    const role = await this.prisma.role.findFirst({
      where: { OR: [{ id }, { name: id.trim().toUpperCase() }] },
    });
    if (!role) {
      throw new NotFoundException(`Role '${id}' not found`);
    }
    if (isBaseRoleName(role.name)) {
      throw new BadRequestException('System base roles cannot be deleted');
    }

    const assignedCount = await this.prisma.userAssignment.count({
      where: { roleId: role.id },
    });
    if (assignedCount > 0) {
      throw new BadRequestException(
        `Cannot delete role '${role.name}': still assigned to ${assignedCount} user(s). Please reassign them before deleting.`,
      );
    }

    await this.prisma.role.delete({
      where: { id: role.id },
    });

    return {
      success: true,
      message: `Role '${role.name}' was successfully deleted`,
    };
  }

  /**
   * Every permission with the roles that grant it, a holder count, and — when `code` is given — the
   * holders of that permission grouped per user and school.
   *
   * Bounded by construction:
   *  - the overview returns one row per permission (42 today) with only a **count** of holders;
   *  - holders are fetched by a single grouped query for one permission at a time, capped by `limit`;
   *  - a person holding the permission through several roles (or several schools) appears **once**,
   *    with every granting role in `roles` — previously the same user was repeated per role.
   */
  async findPermissionOverview(
    actor: AuthenticatedUser,
    query?: QueryPermissionOverviewDto,
  ): Promise<PermissionOverviewEntity[]> {
    const allowedSchools = schoolIdFilter(actor, 'users:assign_role');
    const schoolIds = allowedSchools ? allowedSchools.in : null;
    const code = query?.code?.trim();
    const limit = Math.min(200, Math.max(1, query?.limit ?? 50));

    const permissions = await this.prisma.permission.findMany({
      where: code ? { code } : undefined,
      orderBy: { code: 'asc' },
      include: { rolePermissions: { select: { role: { select: { name: true } } } } },
    });
    if (code && permissions.length === 0) {
      throw new NotFoundException(`Permission '${code}' not found`);
    }

    const counts = await this.countPermissionHolders(schoolIds);
    const holders = code ? await this.findPermissionHolders(code, schoolIds, limit) : undefined;

    return permissions.map((permission) => {
      const entity = new PermissionOverviewEntity({
        code: permission.code,
        description: permission.description,
        roles: permission.rolePermissions.map((rp) => rp.role.name).sort(),
        holdersTotal: counts.get(permission.code) ?? 0,
      });
      if (holders) entity.holders = holders;
      return entity;
    });
  }

  /** Distinct (user, school) holders per permission code: one grouped query, one row per permission. */
  private async countPermissionHolders(schoolIds: string[] | null): Promise<Map<string, number>> {
    if (schoolIds && schoolIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ code: string; holders: bigint }>>`
      SELECT p.code AS code, COUNT(DISTINCT CONCAT(ua.user_id, ':', ua.school_id)) AS holders
      FROM permissions p
      JOIN role_permissions rp ON rp.permission_id = p.id
      JOIN user_assignments ua ON ua.role_id = rp.role_id
      ${schoolIds ? Prisma.sql`WHERE ua.school_id IN (${Prisma.join(schoolIds)})` : Prisma.empty}
      GROUP BY p.code
    `;
    return new Map(rows.map((row) => [row.code, Number(row.holders)]));
  }

  /** Holders of one permission, grouped per user and school, capped by `limit`. */
  private async findPermissionHolders(
    code: string,
    schoolIds: string[] | null,
    limit: number,
  ): Promise<PermissionHolderEntity[]> {
    if (schoolIds && schoolIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<
      Array<{
        userId: string;
        email: string;
        fullName: string;
        status: string;
        schoolId: string;
        schoolName: string;
        roles: string | null;
      }>
    >`
      SELECT ua.user_id AS userId,
             u.email AS email,
             u.full_name AS fullName,
             u.status AS status,
             ua.school_id AS schoolId,
             s.name AS schoolName,
             GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ',') AS roles
      FROM user_assignments ua
      JOIN users u ON u.id = ua.user_id
      JOIN schools s ON s.id = ua.school_id
      JOIN roles r ON r.id = ua.role_id
      JOIN role_permissions rp ON rp.role_id = r.id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE p.code = ${code}
      ${schoolIds ? Prisma.sql`AND ua.school_id IN (${Prisma.join(schoolIds)})` : Prisma.empty}
      GROUP BY ua.user_id, ua.school_id, u.email, u.full_name, u.status, s.name
      ORDER BY u.email ASC
      LIMIT ${limit}
    `;
    return rows.map(
      (row) =>
        new PermissionHolderEntity({
          userId: row.userId,
          email: row.email,
          fullName: row.fullName,
          status: row.status,
          roles: row.roles ? row.roles.split(',') : [],
          schoolId: row.schoolId,
          schoolName: row.schoolName,
        }),
    );
  }
}
