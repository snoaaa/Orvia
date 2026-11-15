import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditEvents } from '../../audit/builders/audit-events.builder.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { SYSTEM_AUDIT_CONTEXT, type AuditRequestContext } from '../../audit/utils/audit-request-context.util.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { ACTIVE_ASSIGNMENT } from '../../auth/utils/active-assignment.util.js';
import { ASSIGN_ROLE_PERMISSION, assertCanGrantRole, grantableRoleLevel } from '../../auth/utils/role-grant.util.js';
import { highestRoleLevel, roleScopeLevel } from '../../auth/utils/role-level.util.js';
import { assertSchoolAccess } from '../../auth/utils/school-scope.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { CreateAssignmentDto, UpdateAssignmentDto } from '../dto/index.js';
import { AssignableRoleEntity, AssignmentEntity } from '../entities/index.js';

/** The role scopes of a user's active assignments, for `assertCanActOnUser`. */
const ACTIVE_ROLE_SCOPES = {
  where: ACTIVE_ASSIGNMENT,
  select: { role: { select: { scope: true } } },
} as const satisfies Prisma.User$assignmentsArgs;

/** A school admin role (#49): school-scoped and able to manage the school's assignments. */
const SCHOOL_ADMIN_ROLE = {
  scope: 'school',
  rolePermissions: { some: { permission: { code: ASSIGN_ROLE_PERMISSION } } },
} as const satisfies Prisma.RoleWhereInput;

/**
 * Assignments (Sections 4.5 and 4.7): a user's role in a school, optionally in one of its groups.
 * A user has at most one assignment per school. Its role and group change through PATCH /assignments/:id
 * (or the role alone through PATCH /identity/users/:id/role); its school never changes. DELETE /assignments/:id
 * soft-deletes it (`deleted_at`): every reader must use ACTIVE_ASSIGNMENT.
 */
@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * POST /assignments (#47).
   *
   *  - 403: another school, a role above the admin's own level, or a user who outranks the admin.
   *  - 404: unknown user, school or group. 400: unknown role, deactivated school, group of another school,
   *    or a group on a platform role.
   *  - 409: the user already has an assignment in this school. The user row is locked while checking,
   *    so two simultaneous requests cannot both create one.
   *  - With a group, the user is also added to the group members.
   */
  async createAssignment(
    dto: CreateAssignmentDto,
    actor: AuthenticatedUser,
    auditContext: AuditRequestContext = SYSTEM_AUDIT_CONTEXT,
  ): Promise<AssignmentEntity> {
    assertSchoolAccess(actor, ASSIGN_ROLE_PERMISSION, dto.schoolId);

    const [target, school, role] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: dto.userId },
        select: { id: true, email: true, assignments: ACTIVE_ROLE_SCOPES },
      }),
      this.prisma.school.findUnique({ where: { id: dto.schoolId }, select: { id: true, name: true, status: true } }),
      this.prisma.role.findUnique({ where: { name: dto.role }, select: { id: true, name: true, scope: true } }),
    ]);
    if (!target) {
      throw new NotFoundException(`User with ID ${dto.userId} not found`);
    }
    if (!school) {
      throw new NotFoundException(`School with ID ${dto.schoolId} not found`);
    }
    if (school.status === 'deactivated') {
      throw new BadRequestException('Cannot assign a user to a deactivated school');
    }
    if (!role) {
      throw new BadRequestException(`Unknown role '${dto.role}'`);
    }

    assertCanGrantRole(actor, role, dto.schoolId);
    this.assertCanActOnUser(actor, target.assignments, dto.schoolId);

    const group = dto.groupId ? await this.findGroupOfSchool(dto.groupId, dto.schoolId, role.scope) : null;

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${target.id} FOR UPDATE`;
      // A removed assignment (#49) does not block a new one in the same school.
      const existing = await tx.userAssignment.findFirst({
        where: { userId: target.id, schoolId: school.id, ...ACTIVE_ASSIGNMENT },
        select: { role: { select: { name: true } } },
      });
      if (existing) {
        throw new ConflictException(
          `User already has the ${existing.role.name} role in this school; use PATCH /identity/users/:id/role to change it`,
        );
      }
      const assignment = await tx.userAssignment.create({
        data: { userId: target.id, schoolId: school.id, groupId: group?.id ?? null, roleId: role.id },
      });
      if (group) {
        await tx.groupMember.upsert({
          where: { groupId_userId: { groupId: group.id, userId: target.id } },
          create: { groupId: group.id, userId: target.id },
          update: {},
        });
      }
      return assignment;
    });

    await this.audit.record(
      AuditEvents.roleAssigned(
        {
          userId: target.id,
          email: target.email,
          schoolId: school.id,
          groupId: group?.id ?? null,
          role: role.name,
          previousRole: null,
          assignedBy: { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
        },
        auditContext,
      ),
    );

    return new AssignmentEntity({
      id: created.id,
      userId: target.id,
      schoolId: school.id,
      schoolName: school.name,
      groupId: group?.id ?? null,
      groupName: group?.name ?? null,
      role: role.name,
      roleScope: role.scope,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    });
  }

  /**
   * PATCH /assignments/:id (#48): changes the role and/or the group of an assignment, never its school.
   * Re-runs the checks of POST /assignments:
   *
   *  - 404: unknown assignment or group. 400: empty body, unknown role, deactivated school, group of another
   *    school, or a group on a platform role (also when only the role changes and the current group is kept).
   *  - 403: another school, a role above the admin's own level, or a user who outranks the admin.
   *  - No change → no write and no audit event, so `updated_at` only moves on a real change (the mobile sync
   *    relies on it, Section 4.7).
   *  - A new group: the user leaves the old group's members and joins the new one; `groupId: null` only
   *    removes the old membership. The assignment is the only source of a membership in its school (a group
   *    belongs to one school, a user has one assignment per school), so the old one can go.
   */
  async updateAssignment(
    id: string,
    dto: UpdateAssignmentDto,
    actor: AuthenticatedUser,
    auditContext: AuditRequestContext = SYSTEM_AUDIT_CONTEXT,
  ): Promise<AssignmentEntity> {
    if (dto.role === undefined && dto.groupId === undefined) {
      throw new BadRequestException('Nothing to update: give a role and/or a groupId');
    }

    // A removed assignment (#49) is not found: 404.
    const assignment = await this.prisma.userAssignment.findFirst({
      where: { id, ...ACTIVE_ASSIGNMENT },
      select: {
        id: true,
        groupId: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, email: true, assignments: ACTIVE_ROLE_SCOPES } },
        school: { select: { id: true, name: true, status: true } },
        role: { select: { id: true, name: true, scope: true } },
        group: { select: { id: true, name: true } },
      },
    });
    if (!assignment) {
      throw new NotFoundException(`Assignment with ID ${id} not found`);
    }
    const { user, school } = assignment;

    assertSchoolAccess(actor, ASSIGN_ROLE_PERMISSION, school.id);
    if (school.status === 'deactivated') {
      throw new BadRequestException('Cannot change an assignment in a deactivated school');
    }
    this.assertCanActOnUser(actor, user.assignments, school.id);

    let role = assignment.role;
    if (dto.role !== undefined && dto.role !== role.name) {
      const found = await this.prisma.role.findUnique({
        where: { name: dto.role },
        select: { id: true, name: true, scope: true },
      });
      if (!found) {
        throw new BadRequestException(`Unknown role '${dto.role}'`);
      }
      assertCanGrantRole(actor, found, school.id);
      role = found;
    }

    const groupId = dto.groupId === undefined ? assignment.groupId : dto.groupId;
    const toEntity = (group: { id: string; name: string } | null, updatedAt: Date) =>
      new AssignmentEntity({
        id: assignment.id,
        userId: user.id,
        schoolId: school.id,
        schoolName: school.name,
        groupId: group?.id ?? null,
        groupName: group?.name ?? null,
        role: role.name,
        roleScope: role.scope,
        createdAt: assignment.createdAt,
        updatedAt,
      });

    if (role.id === assignment.role.id && groupId === assignment.groupId) {
      return toEntity(assignment.group, assignment.updatedAt);
    }
    const group = groupId ? await this.findGroupOfSchool(groupId, school.id, role.scope) : null;

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;
      // Re-read under the lock, so a concurrent PATCH cannot leave a stale group membership behind,
      // and a concurrent DELETE (#49) makes this one 404.
      const current = await tx.userAssignment.findFirst({
        where: { id: assignment.id, ...ACTIVE_ASSIGNMENT },
        select: { groupId: true, updatedAt: true, role: { select: { id: true, name: true } } },
      });
      if (!current) {
        throw new NotFoundException(`Assignment with ID ${id} not found`);
      }
      if (current.role.id === role.id && current.groupId === groupId) {
        return { changed: false as const, updatedAt: current.updatedAt };
      }
      const updated = await tx.userAssignment.update({
        where: { id: assignment.id },
        data: { roleId: role.id, groupId },
        select: { updatedAt: true },
      });
      if (current.groupId !== groupId) {
        if (current.groupId) {
          await tx.groupMember.deleteMany({ where: { groupId: current.groupId, userId: user.id } });
        }
        if (groupId) {
          await tx.groupMember.upsert({
            where: { groupId_userId: { groupId, userId: user.id } },
            create: { groupId, userId: user.id },
            update: {},
          });
        }
      }
      return { changed: true as const, updatedAt: updated.updatedAt, previous: current };
    });

    if (result.changed) {
      await this.audit.record(
        AuditEvents.assignmentUpdated(
          {
            assignmentId: assignment.id,
            userId: user.id,
            email: user.email,
            schoolId: school.id,
            role: role.name,
            previousRole: result.previous.role.name,
            groupId,
            previousGroupId: result.previous.groupId,
            updatedBy: { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
          },
          auditContext,
        ),
      );
    }

    return toEntity(group, result.updatedAt);
  }

  /**
   * DELETE /assignments/:id (#49): soft delete. Sets `deleted_at` (and `updated_at` moves with it, so the next mobile
   * sync sees the removal, Section 4.7); every reader filters on ACTIVE_ASSIGNMENT, so the access is gone on the
   * user's very next request.
   *
   *  - 404: unknown or already removed assignment (a repeat is not re-run nor audited twice).
   *  - 403: another school, a role above the admin's own level, or a user who outranks the admin.
   *  - 400: deactivated school (same as PATCH).
   *  - 409: the last school admin of the school (see `assertNotLastSchoolAdmin`).
   *  - The user also leaves the members of every group of that school: the assignment was the only source of those
   *    memberships (#48).
   */
  async removeAssignment(
    id: string,
    actor: AuthenticatedUser,
    auditContext: AuditRequestContext = SYSTEM_AUDIT_CONTEXT,
  ): Promise<void> {
    const assignment = await this.prisma.userAssignment.findFirst({
      where: { id, ...ACTIVE_ASSIGNMENT },
      select: {
        id: true,
        user: { select: { id: true, email: true, assignments: ACTIVE_ROLE_SCOPES } },
        school: { select: { id: true, status: true } },
        role: { select: { name: true, scope: true } },
      },
    });
    if (!assignment) {
      throw new NotFoundException(`Assignment with ID ${id} not found`);
    }
    const { user, school } = assignment;

    assertSchoolAccess(actor, ASSIGN_ROLE_PERMISSION, school.id);
    if (school.status === 'deactivated') {
      throw new BadRequestException('Cannot remove an assignment in a deactivated school');
    }
    // Removing a role takes the same right as granting it: a school admin cannot remove a platform role.
    assertCanGrantRole(actor, assignment.role, school.id);
    this.assertCanActOnUser(actor, user.assignments, school.id);

    const removed = await this.prisma.$transaction(async (tx) => {
      // School row first: every removal in this school waits here, so two removals cannot both see the other
      // admin as still there. Then the user row, the lock POST and PATCH take (always school → user, no deadlock).
      await tx.$queryRaw`SELECT id FROM schools WHERE id = ${school.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;
      // Re-read under the locks: a concurrent DELETE makes this one 404, a concurrent PATCH may have changed it.
      const current = await tx.userAssignment.findFirst({
        where: { id, ...ACTIVE_ASSIGNMENT },
        select: { roleId: true, groupId: true, role: { select: { name: true } }, user: { select: { status: true } } },
      });
      if (!current) {
        throw new NotFoundException(`Assignment with ID ${id} not found`);
      }
      await this.assertNotLastSchoolAdmin(tx, { id, schoolId: school.id, roleId: current.roleId, userStatus: current.user.status });

      // Same instant for both: a sync reading `updated_at > lastSync` gets the row with its `deleted_at`.
      const now = new Date();
      await tx.userAssignment.update({ where: { id }, data: { deletedAt: now, updatedAt: now } });
      const stillInSchool = await tx.userAssignment.count({
        where: { userId: user.id, schoolId: school.id, ...ACTIVE_ASSIGNMENT },
      });
      if (stillInSchool === 0) {
        await tx.groupMember.deleteMany({ where: { userId: user.id, group: { schoolId: school.id } } });
      }
      return current;
    });

    await this.audit.record(
      AuditEvents.assignmentRemoved(
        {
          assignmentId: id,
          userId: user.id,
          email: user.email,
          schoolId: school.id,
          role: removed.role.name,
          groupId: removed.groupId,
          removedBy: { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
        },
        auditContext,
      ),
    );
  }

  /**
   * 409 when removing this assignment would leave its school without a school admin (#49).
   *
   * A "school admin" is an active assignment in that school whose role is school-scoped and grants
   * users:assign_role (data-driven like admin-role.util.ts, so a custom admin role counts too; today SCHOOL_ADMIN).
   * Platform roles do not count: they are not the school's own admin. Only admins whose user is not SUSPENDED count
   * (an INVITED one can still activate). Removing a suspended admin is always allowed: the school does not lose a
   * working admin. Run under the school row lock taken by the caller.
   */
  private async assertNotLastSchoolAdmin(
    tx: Prisma.TransactionClient,
    removed: { id: string; schoolId: string; roleId: string; userStatus: string },
  ): Promise<void> {
    if (removed.userStatus === 'SUSPENDED') return;
    const isSchoolAdminRole = (await tx.role.count({ where: { id: removed.roleId, ...SCHOOL_ADMIN_ROLE } })) > 0;
    if (!isSchoolAdminRole) return;
    const otherAdmins = await tx.userAssignment.count({
      where: {
        ...ACTIVE_ASSIGNMENT,
        schoolId: removed.schoolId,
        id: { not: removed.id },
        role: SCHOOL_ADMIN_ROLE,
        user: { status: { not: 'SUSPENDED' } },
      },
    });
    if (otherAdmins === 0) {
      throw new ConflictException(
        'Cannot remove the last school administrator of this school: assign another one first',
      );
    }
  }

  /**
   * GET /assignments/assignable-roles (#47): roles at or below the admin's level, highest first.
   * With `schoolId`, the level only counts the admin's roles in that school (and platform roles).
   */
  async listAssignableRoles(actor: AuthenticatedUser, schoolId?: string): Promise<AssignableRoleEntity[]> {
    if (schoolId !== undefined) {
      assertSchoolAccess(actor, ASSIGN_ROLE_PERMISSION, schoolId);
    }
    const maxLevel = grantableRoleLevel(actor, schoolId);
    const roles = await this.prisma.role.findMany({ select: { id: true, name: true, scope: true } });
    return roles
      .map((r) => new AssignableRoleEntity({ ...r, level: roleScopeLevel(r.scope) }))
      .filter((r) => r.level <= maxLevel)
      .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
  }

  /** 403 when the user already holds a role above the admin's own level in that school (no acting on a superior). */
  private assertCanActOnUser(
    actor: AuthenticatedUser,
    targetAssignments: readonly { role: { scope: string } }[],
    schoolId: string,
  ): void {
    if (highestRoleLevel(targetAssignments.map((a) => a.role.scope)) > grantableRoleLevel(actor, schoolId)) {
      throw new ForbiddenException('You cannot assign a user who holds a higher-level role');
    }
  }

  /** The group must exist (404) and belong to the school (400); a platform role is never limited to a group (400). */
  private async findGroupOfSchool(groupId: string, schoolId: string, roleScope: string) {
    if (roleScope === 'platform') {
      throw new BadRequestException('A platform role cannot be limited to a group');
    }
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true, name: true, schoolId: true },
    });
    if (!group) {
      throw new NotFoundException(`Group with ID ${groupId} not found`);
    }
    if (group.schoolId !== schoolId) {
      throw new BadRequestException('The group does not belong to this school');
    }
    return group;
  }
}
