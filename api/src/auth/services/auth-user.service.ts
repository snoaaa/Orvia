import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { AuthenticatedUser, AuthRoleAssignment } from '../types/authenticated-user.js';

/** Builds the AuthenticatedUser from the database: user, assignments, roles and permissions. */
@Injectable()
export class AuthUserService {
  constructor(private readonly prisma: PrismaService) {}

  async load(userId: string, sessionId: string | null = null): Promise<AuthenticatedUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        assignments: {
          orderBy: { createdAt: 'asc' },
          include: {
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
      groupId: a.groupId,
      permissions: a.role.rolePermissions.map((rp) => rp.permission.code),
    }));

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      status: user.status,
      assignments,
      permissions: [...new Set(assignments.flatMap((a) => a.permissions))].sort(),
      schoolIds: [...new Set(assignments.map((a) => a.schoolId))],
      isPlatformAdmin: assignments.some((a) => a.scope === 'platform'),
      role: assignments[0]?.role ?? null,
      schoolId: assignments[0]?.schoolId ?? null,
      sessionId,
    };
  }
}
