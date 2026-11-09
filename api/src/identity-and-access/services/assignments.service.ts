import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditEvents } from '../../audit/builders/audit-events.builder.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { SYSTEM_AUDIT_CONTEXT, type AuditRequestContext } from '../../audit/utils/audit-request-context.util.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { ASSIGN_ROLE_PERMISSION, assertCanGrantRole, grantableRoleLevel } from '../../auth/utils/role-grant.util.js';
import { highestRoleLevel, roleScopeLevel } from '../../auth/utils/role-level.util.js';
import { assertSchoolAccess } from '../../auth/utils/school-scope.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { CreateAssignmentDto } from '../dto/index.js';
import { AssignableRoleEntity, AssignmentEntity } from '../entities/index.js';

/**
 * Assignments (Sections 4.5 and 4.7): a user's role in a school, optionally in one of its groups.
 * A user has at most one assignment per school; changing it goes through PATCH /identity/users/:id/role.
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
        select: { id: true, email: true, assignments: { select: { role: { select: { scope: true } } } } },
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
    if (highestRoleLevel(target.assignments.map((a) => a.role.scope)) > grantableRoleLevel(actor, dto.schoolId)) {
      throw new ForbiddenException('You cannot assign a user who holds a higher-level role');
    }

    const group = dto.groupId ? await this.findGroupOfSchool(dto.groupId, dto.schoolId, role.scope) : null;

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${target.id} FOR UPDATE`;
      const existing = await tx.userAssignment.findFirst({
        where: { userId: target.id, schoolId: school.id },
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
    });
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
