import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { User, UserStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import argon2 from 'argon2';
import { AuditEvents } from '../../audit/builders/audit-events.builder.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { SYSTEM_AUDIT_CONTEXT, type AuditRequestContext } from '../../audit/utils/audit-request-context.util.js';
import { ActiveSessionEntity } from '../../auth/entities/index.js';
import { SessionService } from '../../auth/services/session.service.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { isAdminRole, isBaseRoleName, PLATFORM_ADMIN_PERMISSION } from '../../auth/utils/admin-role.util.js';
import { assertCanGrantRole } from '../../auth/utils/role-grant.util.js';
import { highestRoleLevel, roleScopeLevel } from '../../auth/utils/role-level.util.js';
import { assertSchoolAccess, schoolIdFilter, schoolsWithPermission } from '../../auth/utils/school-scope.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { AssignRoleDto, CreateRoleDto, UpdateRoleDto, CreateSchoolDto, UpdateSchoolDto, ListSchoolsQueryDto, ListUsersQueryDto, CreateUserDto, InviteUserDto, QueryPermissionOverviewDto, UpdateUserDto, UpdateUserProfileDto } from '../dto/index.js';
import {
  PaginatedSchoolsEntity,
  PaginatedUsersEntity,
  PermissionHolderEntity,
  PermissionEntity,
  PermissionOverviewEntity,
  RoleEntity,
  SchoolEntity,
  UserDetailEntity,
  UserEntity,
  UserListItemEntity,
} from '../entities/index.js';
import { SchoolMapper, UserMapper } from '../mappers/index.js';
import { DomainValidationService } from './domain-validation.service.js';
import { assertDomainsAvailable, parseDomainList } from '../utils/school-domain.util.js';
import { ACTIVE_ASSIGNMENT } from '../../auth/utils/active-assignment.util.js';

/** Role given to invited users when none is specified. */
const DEFAULT_INVITE_ROLE = 'STUDENT';

interface RoleWithPermissions {
  scope: string;
  rolePermissions?: ReadonlyArray<{ permission: { code: string } }>;
}

/** A user with the school and role scope of each assignment: what the account-status rules need. */
type UserWithAssignments = User & { assignments: { schoolId: string; role: { scope: string } }[] };

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
      const group = await this.prisma.group.findFirst({ where: { id: query.groupId, deletedAt: null }, select: { schoolId: true } });
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
      ...ACTIVE_ASSIGNMENT,
      ...(query.schoolId ? { schoolId: query.schoolId } : scope ? { schoolId: scope } : {}),
      ...(query.role && { role: { name: query.role } }),
    };
    const filters: Prisma.UserWhereInput[] = [];
    if (scope) filters.push({ assignments: { some: { ...ACTIVE_ASSIGNMENT, schoolId: scope } } });
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
            where: { ...ACTIVE_ASSIGNMENT, ...(scope && { schoolId: scope }) },
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
          where: { ...ACTIVE_ASSIGNMENT, ...(scope && { schoolId: scope }) },
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

  /** Loads a user with the school and role scope of each assignment; 404 if they do not exist. */
  private async findUserWithAssignments(id: string): Promise<UserWithAssignments> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { assignments: { where: ACTIVE_ASSIGNMENT, select: { schoolId: true, role: { select: { scope: true } } } } },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  /** Loads a user and throws 403 unless `actor` has `permission` in one of the user's schools. */
  private async findUserInScope(id: string, actor: AuthenticatedUser, permission: string): Promise<UserWithAssignments> {
    const user = await this.findUserWithAssignments(id);
    assertSchoolAccess(actor, permission, user.assignments.map((a) => a.schoolId));
    return user;
  }

  /**
   * Rules for changing another user's account status (Section 4.6), shared by every suspension and
   * reactivation path so none can bypass them:
   *  - nobody can act on their own account;
   *  - platform-wide `users:suspend` reaches every user; otherwise the actor must hold it in ALL of
   *    the target's schools (the status applies to the whole account), and a user without any
   *    school is out of reach;
   *  - the target must not hold a higher-level role than the actor (see role-level.util.ts).
   */
  private assertCanChangeAccountStatus(target: UserWithAssignments, actor: AuthenticatedUser, action: 'suspend' | 'reactivate'): void {
    if (target.id === actor.id) {
      throw new ForbiddenException(`You cannot ${action} your own account`);
    }

    const actorSchools = schoolsWithPermission(actor, 'users:suspend');
    if (actorSchools !== 'all') {
      const targetSchools = target.assignments.map((a) => a.schoolId);
      if (targetSchools.length === 0 || !targetSchools.every((schoolId) => actorSchools.includes(schoolId))) {
        throw new ForbiddenException(`You can only ${action} users whose schools you all administer`);
      }
    }

    // A platform admin always acts at platform level, whatever shape their assignments have.
    const actorLevel = actor.isPlatformAdmin
      ? roleScopeLevel('platform')
      : highestRoleLevel(
          actor.assignments.filter((a) => a.permissions.includes('users:suspend')).map((a) => a.scope),
        );
    const targetLevel = highestRoleLevel(target.assignments.map((a) => a.role.scope));
    if (targetLevel > actorLevel) {
      throw new ForbiddenException(`You cannot ${action} a user with a higher-level role`);
    }
  }

  /**
   * PATCH /users/:id/suspend (#41): blocks the account and revokes all its sessions.
   * Idempotent: an already suspended user stays suspended and any session left active is revoked.
   */
  async suspendUser(
    id: string,
    actor: AuthenticatedUser,
    auditContext: AuditRequestContext = SYSTEM_AUDIT_CONTEXT,
  ): Promise<UserEntity> {
    const target = await this.findUserWithAssignments(id);
    this.assertCanChangeAccountStatus(target, actor, 'suspend');
    return this.applySuspension(target, actor, auditContext);
  }

  /**
   * Status a SUSPENDED user gets back. A user suspended before finishing the invitation (no password
   * set and no Google account linked) returns to INVITED, so the invitation flow is not skipped.
   */
  private statusAfterReactivation(user: Pick<User, 'passwordHash' | 'googleSub'>): UserStatus {
    return !user.passwordHash && !user.googleSub ? 'INVITED' : 'ACTIVE';
  }

  /**
   * PATCH /users/:id/reactivate (#42): lifts the suspension so the user can sign in again. The user goes
   * back to ACTIVE, or to INVITED when they never finished the invitation (see statusAfterReactivation).
   * Sessions revoked by the suspension stay revoked: the user signs in again to get new ones.
   * Idempotent for an ACTIVE user; a user who is currently INVITED is refused (409).
   */
  async reactivateUser(
    id: string,
    actor: AuthenticatedUser,
    // Unused for now: #51 will use it to record the reactivation audit event.
    _auditContext: AuditRequestContext = SYSTEM_AUDIT_CONTEXT,
  ): Promise<UserEntity> {
    const target = await this.findUserWithAssignments(id);
    this.assertCanChangeAccountStatus(target, actor, 'reactivate');
    if (target.status === 'INVITED') {
      throw new ConflictException('Only a suspended user can be reactivated (this user is still INVITED)');
    }
    const user =
      target.status === 'ACTIVE'
        ? target
        : await this.prisma.user.update({ where: { id }, data: { status: this.statusAfterReactivation(target) } });
    return UserMapper.toEntity(user);
  }

  /**
   * Sets SUSPENDED first, then revokes the sessions (each revocation is audited as session_revoked).
   * In this order the user is blocked even if a revocation fails: the guard and the refresh check
   * the status on every request, and calling suspend again revokes what is left.
   */
  private async applySuspension(
    user: User,
    actor: AuthenticatedUser,
    auditContext: AuditRequestContext,
  ): Promise<UserEntity> {
    const suspended =
      user.status === 'SUSPENDED'
        ? user
        : await this.prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });
    await this.sessions.revokeAllForUser(
      user.id,
      'user_suspended',
      { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
      auditContext,
    );
    return UserMapper.toEntity(suspended);
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
    // Suspending and reactivating go through the same rules as their PATCH /users/:id/* routes, before any write.
    const suspending = dto.status?.toUpperCase() === 'SUSPENDED';
    if (suspending) {
      this.assertCanChangeAccountStatus(target, actor, 'suspend');
    } else if (dto.status?.toUpperCase() === 'ACTIVE') {
      this.assertCanChangeAccountStatus(target, actor, 'reactivate');
    } else if (dto.status) {
      // Any other status is a separate right from editing a profile.
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

    // Lifting a suspension follows PATCH /users/:id/reactivate: back to INVITED if the invitation was never finished.
    const status =
      dto.status?.toUpperCase() === 'ACTIVE' && target.status === 'SUSPENDED'
        ? this.statusAfterReactivation(target)
        : (dto.status?.toUpperCase() as UserStatus | undefined);
    const data: Prisma.UserUpdateInput = {
      ...(dto.email && { email: dto.email.trim().toLowerCase() }),
      ...(dto.fullName && { fullName: dto.fullName.trim() }),
      ...(status && !suspending && { status }),
    };
    const updated = Object.keys(data).length > 0 ? await this.prisma.user.update({ where: { id }, data }) : target;
    return suspending ? this.applySuspension(updated, actor, auditContext) : UserMapper.toEntity(updated);
  }

  /**
   * Creates or replaces a user's role in one school (role reassignment).
   *
   * Enforces:
   *  - `users:assign_role` in the target school (platform admins may act on any school).
   *  - The school and the role must exist (404 / 400).
   *  - The role must be at or below the admin's own level in that school (403), via `assertCanGrantRole`,
   *    the same check as POST /assignments: only a platform admin can grant a platform-scoped role.
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
    assertSchoolAccess(actor, 'users:assign_role', dto.schoolId);

    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        assignments: {
          where: ACTIVE_ASSIGNMENT,
          include: { role: { include: { rolePermissions: { select: { permission: { select: { code: true } } } } } } },
        },
      },
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
    assertCanGrantRole(actor, role, dto.schoolId);

    if (actorScope !== 'all' && target.assignments.length > 0) {
      const targetInSchool = target.assignments.some((a) => a.schoolId === dto.schoolId);
      if (!targetInSchool) {
        throw new ForbiddenException('A school admin cannot grant permissions to a user outside their school');
      }
    }

    const roleGrantsDocManage =
      role.name === 'CONTENT_MANAGER' ||
      role.rolePermissions.some(
        (rp) => rp.permission.code === 'documents:manage' || rp.permission.code === 'documents.manage',
      );

    if (roleGrantsDocManage) {
      const isStudent =
        target.assignments.some((a) => a.schoolId === dto.schoolId && a.role.name.toUpperCase() === 'STUDENT') ||
        (target.assignments.length > 0 && target.assignments.every((a) => a.role.name.toUpperCase() === 'STUDENT'));
      if (isStudent) {
        throw new BadRequestException('Student accounts can never receive document management permissions');
      }
    }

    const existing = target.assignments.find((a) => a.schoolId === dto.schoolId);
    if (existing?.roleId === role.id) {
      return UserMapper.toEntity(target);
    }

    const txResult = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${target.id} FOR UPDATE`;
      const lockedRole = await tx.$queryRaw<Array<{ id: string; scope: string; name: string }>>`
        SELECT id, scope, name FROM roles WHERE id = ${role.id} FOR UPDATE
      `;
      const freshRole = lockedRole[0];
      if (!freshRole) {
        throw new BadRequestException(`Unknown role '${roleName}'`);
      }
      if (freshRole.scope !== role.scope) {
        throw new ConflictException(
          `Role '${freshRole.name}' changed scope while the assignment was being updated; retry the request`,
        );
      }

      const current = await tx.userAssignment.findFirst({
        where: { userId: target.id, schoolId: dto.schoolId, ...ACTIVE_ASSIGNMENT },
        include: { role: { include: { rolePermissions: { select: { permission: { select: { code: true } } } } } } },
      });
      if (current?.roleId === role.id) {
        return { changed: false as const };
      }

      const prevRoleGrantsDocManage =
        current?.role.name === 'CONTENT_MANAGER' ||
        current?.role.rolePermissions?.some(
          (rp) => rp.permission.code === 'documents:manage' || rp.permission.code === 'documents.manage',
        ) ||
        false;

      if (current) {
        await tx.userAssignment.update({ where: { id: current.id }, data: { roleId: role.id } });
      } else {
        await tx.userAssignment.create({
          data: { userId: target.id, schoolId: dto.schoolId, roleId: role.id },
        });
      }

      return {
        changed: true as const,
        prevRoleGrantsDocManage,
        previousRoleName: current?.role.name ?? null,
      };
    });

    if (!txResult.changed) {
      return UserMapper.toEntity(target);
    }

    if (roleGrantsDocManage && !txResult.prevRoleGrantsDocManage) {
      await this.audit.record(
        AuditEvents.permissionGranted(
          {
            userId: target.id,
            email: target.email,
            schoolId: dto.schoolId,
            permission: 'documents:manage',
            grantedBy: { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
          },
          auditContext,
        ),
      );
    } else if (!roleGrantsDocManage && txResult.prevRoleGrantsDocManage) {
      await this.audit.record(
        AuditEvents.permissionRevoked(
          {
            userId: target.id,
            email: target.email,
            schoolId: dto.schoolId,
            permission: 'documents:manage',
            revokedBy: { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
          },
          auditContext,
        ),
      );
    }

    await this.audit.record(
      AuditEvents.roleAssigned(
        {
          userId: target.id,
          email: target.email,
          schoolId: dto.schoolId,
          role: role.name,
          previousRole: txResult.previousRoleName,
          assignedBy: { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
        },
        auditContext,
      ),
    );

    return UserMapper.toEntity(target);
  }

  /**
   * Grant document-management rights to a staff member in a school (Â§4.5, #88).
   *
   * Enforces:
   *  - Caller must hold users:assign_role. Platform admins can grant in any school;
   *    school admins can only grant in their own school(s).
   *  - School admins cannot grant permissions to a user outside their school (403).
   *  - Students can NEVER receive document-management rights (400).
   *  - Idempotent: granting when already held is a no-op.
   *  - Records tamper-evident audit events `permission_granted` and `role_assigned`.
   */
  async grantDocumentManagement(
    userId: string,
    schoolId: string,
    actor: AuthenticatedUser,
    auditContext: AuditRequestContext = SYSTEM_AUDIT_CONTEXT,
  ): Promise<UserEntity> {
    const actorScope = schoolsWithPermission(actor, 'users:assign_role');
    if (actorScope !== 'all') {
      assertSchoolAccess(actor, 'users:assign_role', schoolId);
    }

    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true },
    });
    if (!school) {
      throw new NotFoundException(`School with ID ${schoolId} not found`);
    }

    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { assignments: { include: { role: true } } },
    });
    if (!target) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (actorScope !== 'all') {
      const targetInSchool = target.assignments.some((a) => a.schoolId === schoolId);
      if (!targetInSchool) {
        throw new ForbiddenException('A school admin cannot grant permissions to a user outside their school');
      }
    }

    const isStudent =
      target.assignments.some((a) => a.schoolId === schoolId && a.role.name.toUpperCase() === 'STUDENT') ||
      (target.assignments.length > 0 && target.assignments.every((a) => a.role.name.toUpperCase() === 'STUDENT'));
    if (isStudent) {
      throw new BadRequestException('Student accounts can never receive document management permissions');
    }

    let role = await this.prisma.role.findFirst({
      where: { name: 'CONTENT_MANAGER' },
    });
    if (!role) {
      role = await this.prisma.role.create({
        data: {
          name: 'CONTENT_MANAGER',
          scope: 'school',
        },
      });
    }

    const existing = target.assignments.find((a) => a.schoolId === schoolId);
    if (existing?.roleId === role.id) {
      return UserMapper.toEntity(target);
    }

    if (existing) {
      await this.prisma.userAssignment.update({ where: { id: existing.id }, data: { roleId: role.id } });
    } else {
      await this.prisma.userAssignment.create({
        data: { userId: target.id, schoolId, roleId: role.id },
      });
    }

    await this.audit.record(
      AuditEvents.permissionGranted(
        {
          userId: target.id,
          email: target.email,
          schoolId,
          permission: 'documents:manage',
          grantedBy: { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
        },
        auditContext,
      ),
    );

    await this.audit.record(
      AuditEvents.roleAssigned(
        {
          userId: target.id,
          email: target.email,
          schoolId,
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
   * Revoke document-management rights from a staff member in a school (Â§4.5, #88).
   *
   * Enforces:
   *  - Caller must hold users:assign_role. Platform admins can revoke in any school;
   *    school admins can only revoke in their own school(s).
   *  - School admins cannot revoke permissions for a user outside their school (403).
   *  - Idempotent: revoking when not held is a no-op.
   *  - Reverts user assignment to STAFF.
   *  - Records tamper-evident audit events `permission_revoked` and `role_assigned`.
   */
  async revokeDocumentManagement(
    userId: string,
    schoolId: string,
    actor: AuthenticatedUser,
    auditContext: AuditRequestContext = SYSTEM_AUDIT_CONTEXT,
  ): Promise<UserEntity> {
    const actorScope = schoolsWithPermission(actor, 'users:assign_role');
    if (actorScope !== 'all') {
      assertSchoolAccess(actor, 'users:assign_role', schoolId);
    }

    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true },
    });
    if (!school) {
      throw new NotFoundException(`School with ID ${schoolId} not found`);
    }

    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { assignments: { include: { role: true } } },
    });
    if (!target) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (actorScope !== 'all') {
      const targetInSchool = target.assignments.some((a) => a.schoolId === schoolId);
      if (!targetInSchool) {
        throw new ForbiddenException('A school admin cannot revoke permissions for a user outside their school');
      }
    }

    const existing = target.assignments.find((a) => a.schoolId === schoolId);
    if (!existing || existing.role.name.toUpperCase() !== 'CONTENT_MANAGER') {
      return UserMapper.toEntity(target);
    }

    let staffRole = await this.prisma.role.findFirst({
      where: { name: 'STAFF' },
    });
    if (!staffRole) {
      staffRole = await this.prisma.role.create({
        data: {
          name: 'STAFF',
          scope: 'school',
        },
      });
    }

    await this.prisma.userAssignment.update({
      where: { id: existing.id },
      data: { roleId: staffRole.id },
    });

    await this.audit.record(
      AuditEvents.permissionRevoked(
        {
          userId: target.id,
          email: target.email,
          schoolId,
          permission: 'documents:manage',
          revokedBy: { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
        },
        auditContext,
      ),
    );

    await this.audit.record(
      AuditEvents.roleAssigned(
        {
          userId: target.id,
          email: target.email,
          schoolId,
          role: staffRole.name,
          previousRole: existing.role.name,
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
      // Same rules as POST /schools/:id/domains (#32): valid format, no overlap with another school.
      domainList = parseDomainList(dto.allowedDomains);
      await assertDomainsAvailable(this.prisma, domainList, id);
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
    // Same rules as POST /schools/:id/domains (#32): valid format, no overlap with another school.
    const domainList = parseDomainList(dto.allowedDomains || '');
    await assertDomainsAvailable(this.prisma, domainList);

    const status = dto.status?.trim() || 'active';

    const created = await this.prisma.school.create({
      data: {
        id,
        name: trimmedName,
        status,
        allowedDomains: domainList.join(','),
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
        assignments: {
          where: ACTIVE_ASSIGNMENT,
          distinct: ['userId'],
          select: { userId: true },
        },
      },
    });
    return roles.map((role) => this.toRoleEntity(role));
  }

  /**
   * One sorted permission list feeds both arrays: `permissions` and `permissionIds` are documented as
   * parallel, so they must never be ordered by different comparators (`.sort()` is UTF-16 order, where
   * `.` < `:`, while `localeCompare` shifts punctuation — the two disagreed for dotted codes).
   */
  private toRoleEntity(role: {
    id: string;
    name: string;
    scope: string;
    rolePermissions: Array<{ permission: { id: string; code: string } }>;
    assignments: Array<{ userId: string }>;
    createdAt: Date;
    updatedAt: Date;
  }): RoleEntity {
    const permissions = role.rolePermissions
      .map((rolePermission) => rolePermission.permission)
      .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    return new RoleEntity({
      id: role.id,
      name: role.name,
      scope: role.scope,
      permissions: permissions.map((permission) => permission.code),
      permissionIds: permissions.map((permission) => permission.id),
      assignedUsersCount: new Set(role.assignments.map((assignment) => assignment.userId)).size,
      isBase: isBaseRoleName(role.name),
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    });
  }

  async findRoleById(id: string): Promise<RoleEntity> {
    const role = await this.prisma.role.findFirst({
      where: { OR: [{ id }, { name: id.trim().toUpperCase() }] },
      include: {
        rolePermissions: {
          include: { permission: true },
        },
        assignments: {
          where: ACTIVE_ASSIGNMENT,
          distinct: ['userId'],
          select: { userId: true },
        },
      },
    });
    if (!role) {
      throw new NotFoundException(`Role '${id}' not found`);
    }
    return this.toRoleEntity(role);
  }

  /**
   * `system:manage` (or the `*` wildcard) is the platform-administration permission: a role holding
   * it must be platform-scoped, otherwise a school-scoped role could administer the whole platform.
   * Enforced on create and on edit.
   */
  private assertScopeAllowsPermissions(scope: string, codes: readonly string[]): void {
    const grantsPlatformAdministration = codes.some(
      (code) => code === PLATFORM_ADMIN_PERMISSION || code === '*',
    );
    if (grantsPlatformAdministration && scope !== 'platform') {
      throw new BadRequestException(
        `A role that grants ${PLATFORM_ADMIN_PERMISSION} must have the platform scope`,
      );
    }
  }

  /**
   * POST /roles (#44), also behind the older POST /identity/roles: creates a custom role with its scope and
   * permission codes. Platform admins only: the guard checks system:manage, and this also refuses a
   * school-scoped role that would hold it. The role and its permissions are written in one transaction.
   */
  async createRole(
    dto: CreateRoleDto,
    actor: AuthenticatedUser,
    _auditContext: AuditRequestContext = SYSTEM_AUDIT_CONTEXT,
  ): Promise<RoleEntity> {
    if (schoolsWithPermission(actor, 'system:manage') !== 'all') {
      throw new ForbiddenException('Only platform administrators may create roles');
    }
    const roleName = dto.name.trim().toUpperCase();
    if (isBaseRoleName(roleName)) {
      throw new BadRequestException(`Role name '${roleName}' is reserved for system base roles`);
    }

    const codes = [...new Set(dto.permissions)];
    this.assertScopeAllowsPermissions(dto.scope, codes);
    const permissions = await this.prisma.permission.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } });
    const unknown = codes.filter((code) => !permissions.some((p) => p.code === code));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown permission code(s): ${unknown.join(', ')}`);
    }

    try {
      const role = await this.prisma.$transaction(async (tx) => {
        const created = await tx.role.create({ data: { id: randomUUID(), name: roleName, scope: dto.scope } });
        await tx.rolePermission.createMany({
          data: permissions.map((p) => ({ roleId: created.id, permissionId: p.id })),
        });
        return created;
      });
      return await this.findRoleById(role.id);
    } catch (error) {
      // The unique index on roles.name decides, so two simultaneous requests cannot both succeed.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Role '${roleName}' already exists`);
      }
      throw error;
    }
  }

  /**
   * Resolves a replacement permission set given either codes or ids (never both), rejecting unknown
   * entries with a 400 that names them. Codes are trimmed, deduplicated and blank-free.
   *
   * Ids are compared in lower case: `@IsUUID()` accepts upper-case UUIDs and MySQL's collation matches
   * them case-insensitively, so `known.has(rawValue)` used to reject a perfectly valid id.
   */
  private async resolvePermissions(input: { codes?: string[]; ids?: string[] }): Promise<{ id: string; code: string }[]> {
    const byId = input.ids !== undefined;
    const values = [
      ...new Set((byId ? input.ids! : input.codes ?? []).map((value) => value.trim()).filter(Boolean)),
    ];
    if (values.length === 0) return [];

    const lookups = values.map((value) => (byId ? value.toLowerCase() : value));
    const found = await this.prisma.permission.findMany({
      where: byId ? { id: { in: lookups } } : { code: { in: lookups } },
      select: { id: true, code: true },
    });
    const known = new Set(
      found.map((permission) => (byId ? permission.id.toLowerCase() : permission.code)),
    );
    const unknown = values.filter((_value, index) => !known.has(lookups[index]));
    if (unknown.length > 0) {
      throw new BadRequestException(
        byId ? `Unknown permission id(s): ${unknown.join(', ')}` : `Unknown permission code(s): ${unknown.join(', ')}`,
      );
    }
    return found;
  }

  /**
   * PATCH /roles/:id (#45), also behind the older PATCH /identity/roles/:id.
   *
   * Edits a custom role's name, scope and/or permission set. Base roles are immutable (400): they are
   * the capability matrix the seed recreates, so a custom role is the only editable kind. The
   * permission set is replaced as a whole, given either as codes (`GET /roles` returns them) or as
   * ids (`GET /permissions` returns them), never both; an unknown entry is 400 and nothing is
   * written. A payload that changes nothing writes nothing and audits nothing.
   *
   * The role row, its permissions and the `updated_at` of its active assignments move in one
   * transaction: the mobile sync (Section 4.7) reads `user_assignments.updated_at`, so a role change
   * reaches the devices of everyone holding it without touching each user. The permissions of a
   * request are read live from the database (`AuthUserService`), so a holder is allowed or refused by
   * the new set on their very next request; the change is recorded as
   * `identity_access/role_updated` with the permission diff.
   */
  async updateRole(
    id: string,
    dto: UpdateRoleDto,
    actor: AuthenticatedUser,
    auditContext: AuditRequestContext = SYSTEM_AUDIT_CONTEXT,
  ): Promise<RoleEntity> {
    // Authorization first: a school-scoped `system:manage` holder must learn nothing about which role
    // ids or names exist, so they get 403 rather than 404/400 for an unknown or base role.
    if (schoolsWithPermission(actor, 'system:manage') !== 'all') {
      throw new ForbiddenException('Only platform administrators may edit roles');
    }

    const renames = dto.name !== undefined;
    const rescopes = dto.scope !== undefined;
    const replacesPermissions = dto.permissions !== undefined || dto.permissionIds !== undefined;
    if (!renames && !rescopes && !replacesPermissions) {
      throw new BadRequestException('Nothing to update: send name, scope, permissions or permissionIds');
    }
    if (dto.permissions !== undefined && dto.permissionIds !== undefined) {
      throw new BadRequestException('Send either permissions (codes) or permissionIds (ids), not both');
    }

    let roleId = id;

    try {
      await this.prisma.$transaction(async (tx) => {
        // Resolve and lock the role row in one statement: POST /assignments (AssignmentsService) locks
        // the same row, so the "an assigned role cannot change scope" rule and an assignment insert
        // cannot interleave — otherwise a role could be re-scoped to `platform` while a school
        // assignment was being created, silently giving that school's user access to every school.
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM roles WHERE id = ${id} OR name = ${id.trim().toUpperCase()} FOR UPDATE
        `;
        if (locked.length === 0) {
          throw new NotFoundException(`Role '${id}' not found`);
        }
        roleId = locked[0].id;

        // Fresh state, read under the lock: the pre-lock values may already be stale.
        const role = await tx.role.findFirst({
          where: { id: roleId },
          include: {
            rolePermissions: { include: { permission: { select: { id: true, code: true } } } },
            assignments: {
              where: ACTIVE_ASSIGNMENT,
              distinct: ['userId'],
              select: { userId: true },
            },
          },
        });
        if (!role) {
          throw new NotFoundException(`Role '${id}' not found`);
        }
        if (isBaseRoleName(role.name)) {
          throw new BadRequestException('System base roles cannot be edited');
        }

        const nextScope = rescopes ? dto.scope! : role.scope;
        const assignedUsersCount = new Set(role.assignments.map((assignment) => assignment.userId)).size;
        if (rescopes && nextScope !== role.scope && assignedUsersCount > 0) {
          // `schoolsWithPermission()` treats a platform-scoped assignment as "all schools", so moving an
          // assigned role into (or out of) the platform scope would silently widen (or narrow) the access
          // of everyone holding it, in schools they were never granted.
          throw new BadRequestException(
            `Cannot change the scope of role '${role.name}': still assigned to ${assignedUsersCount} user(s). Please reassign them first.`,
          );
        }

        let nextName = role.name;
        if (renames) {
          nextName = dto.name!.trim().toUpperCase();
          if (isBaseRoleName(nextName)) {
            throw new BadRequestException(`Role name '${nextName}' is reserved for system base roles`);
          }
          if (nextName !== role.name) {
            const existing = await tx.role.findUnique({ where: { name: nextName }, select: { id: true } });
            if (existing && existing.id !== role.id) {
              throw new ConflictException(`Role '${nextName}' already exists`);
            }
          }
        }

        const permissions = replacesPermissions
          ? await this.resolvePermissions({ codes: dto.permissions, ids: dto.permissionIds })
          : null;
        const nextCodes = permissions ? permissions.map((permission) => permission.code).sort() : null;
        const previousCodes = role.rolePermissions.map((rp) => rp.permission.code).sort();
        const effectiveCodes = nextCodes ?? previousCodes;
        if (replacesPermissions || rescopes) {
          this.assertScopeAllowsPermissions(nextScope, effectiveCodes);
        }
        const permissionsChanged =
          nextCodes !== null &&
          (nextCodes.length !== previousCodes.length ||
            nextCodes.some((code, index) => code !== previousCodes[index]));
        if (nextName === role.name && nextScope === role.scope && !permissionsChanged) {
          // A payload that changes nothing writes nothing — and audits nothing.
          return { changed: false as const };
        }

        await tx.role.update({
          where: { id: role.id },
          data: { name: nextName, ...(rescopes ? { scope: nextScope } : {}) },
        });

        if (permissions) {
          await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
          if (permissions.length > 0) {
            await tx.rolePermission.createMany({
              data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
            });
          }
        }

        // Section 4.7: the mobile delta sync reads `user_assignments.updated_at`, so every active
        // assignment of the role gets a fresh stamp and the change reaches the devices.
        await tx.userAssignment.updateMany({
          where: { roleId: role.id, ...ACTIVE_ASSIGNMENT },
          data: { updatedAt: new Date() },
        });

        // Same transaction as the write: if the audit row cannot be appended, the role edit and the
        // `user_assignments.updated_at` bump roll back with it instead of leaving an unaudited change.
        await this.audit.record(
          AuditEvents.roleUpdated(
            {
              roleId: role.id,
              role: nextName,
              previousName: role.name,
              previousScope: role.scope,
              scope: nextScope,
              permissions: nextCodes ?? previousCodes,
              addedPermissions: nextCodes ? nextCodes.filter((code) => !previousCodes.includes(code)) : [],
              removedPermissions: nextCodes ? previousCodes.filter((code) => !nextCodes.includes(code)) : [],
              updatedBy: { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
            },
            auditContext,
          ),
          tx,
        );

        return { changed: true as const };
      });

      return await this.findRoleById(roleId);
    } catch (error) {
      // The unique index on roles.name decides between two concurrent renames that both passed the
      // check above: answer 409 like the sequential path, not a 500.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Role '${dto.name?.trim().toUpperCase() ?? id}' already exists`);
      }
      throw error;
    }
  }

  /**
   * DELETE /roles/:id (#46), also behind the older DELETE /identity/roles/:id: removes an unused custom
   * role.
   *
   * Platform admins only: the guard checks system:manage and this also refuses a school-scoped role
   * holding it, so a school admin cannot remove a role of the platform. The six base roles are refused
   * (400): they are recreated by the seed and cannot be deleted. A role that still has active
   * assignments is refused too (400), naming how many users hold it, so nobody loses their access by
   * accident; reassign them first. Deleting a role also drops its `role_permissions` rows and any
   * `document_access` rule that granted it (both cascade), which is why an unused role is the only
   * kind worth deleting; the number of dropped rules is recorded in the audit event.
   */
  async deleteRole(
    id: string,
    actor: AuthenticatedUser,
    auditContext: AuditRequestContext = SYSTEM_AUDIT_CONTEXT,
  ): Promise<{ success: boolean; message: string }> {
    // Authorization first: a school-scoped `system:manage` holder must learn nothing about which role
    // ids or names exist, so they get 403 even for an unknown or base role.
    if (schoolsWithPermission(actor, 'system:manage') !== 'all') {
      throw new ForbiddenException('Only platform administrators may delete roles');
    }

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
      where: { roleId: role.id, ...ACTIVE_ASSIGNMENT },
    });
    if (assignedCount > 0) {
      throw new BadRequestException(
        `Cannot delete role '${role.name}': still assigned to ${assignedCount} user(s). Please reassign them before deleting.`,
      );
    }

    // Counted before the delete, purely to report what the ON DELETE CASCADE is about to remove.
    const documentAccessRules = await this.prisma.documentAccess.count({ where: { roleId: role.id } });

    await this.prisma.role.delete({
      where: { id: role.id },
    });

    await this.audit.record(
      AuditEvents.roleDeleted(
        {
          roleId: role.id,
          role: role.name,
          scope: role.scope,
          documentAccessRulesRemoved: documentAccessRules,
          deletedBy: { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
        },
        auditContext,
      ),
    );

    return {
      success: true,
      message: `Role '${role.name}' was successfully deleted`,
    };
  }

  /**
   * GET /permissions: the permission catalogue, sorted by category then code. Platform admins only:
   * the guard checks system:manage, and this also refuses a school-scoped role that would hold it.
   */
  async listPermissions(actor: AuthenticatedUser): Promise<PermissionEntity[]> {
    if (schoolsWithPermission(actor, 'system:manage') !== 'all') {
      throw new ForbiddenException('Only platform administrators may list permissions');
    }
    const rows = await this.prisma.permission.findMany({ select: { id: true, code: true, description: true } });
    return rows
      .map(
        (p) =>
          new PermissionEntity({
            id: p.id,
            code: p.code,
            description: p.description,
            category: p.code.split(':')[0],
          }),
      )
      .sort((a, b) => a.category.localeCompare(b.category) || a.code.localeCompare(b.code));
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
      WHERE ua.deleted_at IS NULL
      ${schoolIds ? Prisma.sql`AND ua.school_id IN (${Prisma.join(schoolIds)})` : Prisma.empty}
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
        AND ua.deleted_at IS NULL
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
