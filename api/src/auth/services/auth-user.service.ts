import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { AuthenticatedUser, AuthRoleAssignment } from '../types/authenticated-user.js';
import { ACTIVE_ASSIGNMENT } from '../utils/active-assignment.util.js';

/** Builds the AuthenticatedUser from the database: user, assignments, roles and permissions. */
@Injectable()
export class AuthUserService {
  constructor(private readonly prisma: PrismaService) {}

  async load(userId: string, sessionId: string | null = null): Promise<AuthenticatedUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        assignments: {
          where: ACTIVE_ASSIGNMENT,
          orderBy: { createdAt: 'asc' },
          include: {
            school: { select: { id: true, name: true, status: true } },
            role: { include: { rolePermissions: { include: { permission: { select: { code: true } } } } } },
          },
        },
      },
    });
    if (!user) return null;

    const assignments: AuthRoleAssignment[] = user.assignments.map((a) => ({
      role: a.role.name,
      scope: a.role.scope,
      schoolId: a.schoolId,
      schoolName: a.school?.name ?? null,
      schoolStatus: a.school?.status ?? null,
      groupId: a.groupId,
      permissions: a.role.rolePermissions.map((rp) => rp.permission.code),
    }));

    const roles = [...new Set(assignments.map((a) => a.role))];
    const schoolsMap = new Map<string, { id: string; name: string; status: string | null }>();
    for (const a of user.assignments) {
      if (a.school && !schoolsMap.has(a.school.id)) {
        schoolsMap.set(a.school.id, {
          id: a.school.id,
          name: a.school.name,
          status: a.school.status ?? null,
        });
      }
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      status: user.status,
      assignments,
      roles,
      permissions: [...new Set(assignments.flatMap((a) => a.permissions))].sort(),
      schoolIds: [...new Set(assignments.map((a) => a.schoolId))],
      schools: [...schoolsMap.values()],
      isPlatformAdmin: assignments.some((a) => a.scope === 'platform'),
      role: assignments[0]?.role ?? null,
      schoolId: assignments[0]?.schoolId ?? null,
      sessionId,
    };
  }
}
