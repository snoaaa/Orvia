import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM_AUDIT_CONTEXT } from '../../audit/utils/audit-request-context.util.js';
import type { AuthenticatedUser, AuthRoleAssignment } from '../../auth/types/authenticated-user.js';
import { IdentityAndAccessService } from './identity-and-access.service.js';

/** Suspending a user (#41): PATCH /users/:id/suspend and the legacy PATCH /identity/users/:id. */
describe('IdentityAndAccessService - suspend a user (#41)', () => {
  let service: IdentityAndAccessService;
  let prisma: { user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } };
  let sessions: { revokeAllForUser: ReturnType<typeof vi.fn> };

  const actorWith = (id: string, ...assignments: AuthRoleAssignment[]): AuthenticatedUser => ({
    id,
    email: `${id}@school.edu`,
    fullName: id,
    status: 'ACTIVE',
    assignments,
    permissions: [...new Set(assignments.flatMap((a) => a.permissions))],
    schoolIds: assignments.map((a) => a.schoolId),
    isPlatformAdmin: assignments.some((a) => a.scope === 'platform'),
    role: assignments[0]?.role ?? null,
    schoolId: assignments[0]?.schoolId ?? null,
    sessionId: null,
  });
  const adminRole = (scope: 'platform' | 'school', schoolId: string): AuthRoleAssignment => ({
    role: scope === 'platform' ? 'PLATFORM_ADMIN' : 'SCHOOL_ADMIN',
    scope,
    schoolId,
    groupId: null,
    permissions: ['users:read', 'users:update', 'users:suspend'],
  });

  const platformAdmin = actorWith('platform-admin', adminRole('platform', 'sys'));
  const adminA = actorWith('admin-a', adminRole('school', 'A'));

  /** A database user row with one assignment per [schoolId, role scope] pair. */
  const userRow = (id: string, assignments: [string, string][], status = 'ACTIVE') => ({
    id,
    email: `${id}@school.edu`,
    fullName: id,
    authProvider: 'google',
    passwordHash: 'hash-never-returned',
    googleSub: null,
    status,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    assignments: assignments.map(([schoolId, scope]) => ({ schoolId, role: { scope } })),
  });

  const givenUser = (row: ReturnType<typeof userRow> | null) => prisma.user.findUnique.mockResolvedValue(row);

  beforeEach(() => {
    prisma = { user: { findUnique: vi.fn(), update: vi.fn() } };
    sessions = { revokeAllForUser: vi.fn().mockResolvedValue(2) };
    service = new IdentityAndAccessService(prisma as never, {} as never, sessions as never, {} as never);
  });

  describe('suspendUser', () => {
    it('suspends the user, then revokes all their sessions with reason user_suspended', async () => {
      const row = userRow('student-a', [['A', 'group']]);
      givenUser(row);
      prisma.user.update.mockResolvedValue({ ...row, status: 'SUSPENDED' });

      const result = await service.suspendUser('student-a', adminA, SYSTEM_AUDIT_CONTEXT);

      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'student-a' }, data: { status: 'SUSPENDED' } });
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
        'student-a',
        'user_suspended',
        { userId: 'admin-a', role: 'SCHOOL_ADMIN', schoolId: 'A' },
        SYSTEM_AUDIT_CONTEXT,
      );
      expect(prisma.user.update.mock.invocationCallOrder[0]).toBeLessThan(
        sessions.revokeAllForUser.mock.invocationCallOrder[0],
      );
      expect(result.status).toBe('SUSPENDED');
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('assignments');
    });

    it('throws 404 when the user does not exist', async () => {
      givenUser(null);
      await expect(service.suspendUser('missing', platformAdmin)).rejects.toBeInstanceOf(NotFoundException);
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('refuses to suspend your own account, even as a platform admin', async () => {
      givenUser(userRow('platform-admin', [['sys', 'platform']]));
      await expect(service.suspendUser('platform-admin', platformAdmin)).rejects.toThrow(
        new ForbiddenException('You cannot suspend your own account'),
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('is idempotent: an already suspended user is not written again, but sessions left are revoked', async () => {
      givenUser(userRow('student-a', [['A', 'group']], 'SUSPENDED'));

      const result = await service.suspendUser('student-a', adminA);

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(sessions.revokeAllForUser).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('SUSPENDED');
    });

    it('allows suspending an INVITED user', async () => {
      givenUser(userRow('invited-a', [['A', 'group']], 'INVITED'));
      prisma.user.update.mockResolvedValue({ ...userRow('invited-a', [['A', 'group']]), status: 'SUSPENDED' });
      await expect(service.suspendUser('invited-a', adminA)).resolves.toMatchObject({ status: 'SUSPENDED' });
    });

    describe('school scope', () => {
      it('a school admin can suspend a user of their own school', async () => {
        givenUser(userRow('staff-a', [['A', 'school']]));
        prisma.user.update.mockResolvedValue({ ...userRow('staff-a', [['A', 'school']]), status: 'SUSPENDED' });
        await expect(service.suspendUser('staff-a', adminA)).resolves.toMatchObject({ status: 'SUSPENDED' });
      });

      it('a school admin cannot suspend a user of another school', async () => {
        givenUser(userRow('student-b', [['B', 'group']]));
        await expect(service.suspendUser('student-b', adminA)).rejects.toThrow(
          new ForbiddenException('You can only suspend users whose schools you all administer'),
        );
      });

      it('a school admin cannot suspend a user who is also in a school they do not administer', async () => {
        givenUser(userRow('mixed', [['A', 'group'], ['B', 'school']]));
        await expect(service.suspendUser('mixed', adminA)).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
      });

      it('an admin of every school of the user can suspend them', async () => {
        const adminAB = actorWith('admin-ab', adminRole('school', 'A'), adminRole('school', 'B'));
        givenUser(userRow('mixed', [['A', 'group'], ['B', 'school']]));
        prisma.user.update.mockResolvedValue({ ...userRow('mixed', []), status: 'SUSPENDED' });
        await expect(service.suspendUser('mixed', adminAB)).resolves.toMatchObject({ status: 'SUSPENDED' });
      });

      it('a user without any school can only be suspended by a platform admin', async () => {
        givenUser(userRow('orphan', []));
        await expect(service.suspendUser('orphan', adminA)).rejects.toBeInstanceOf(ForbiddenException);

        prisma.user.update.mockResolvedValue({ ...userRow('orphan', []), status: 'SUSPENDED' });
        await expect(service.suspendUser('orphan', platformAdmin)).resolves.toMatchObject({ status: 'SUSPENDED' });
      });

      it('only schools where the actor holds users:suspend count', async () => {
        const staffAdmin = actorWith('staff-admin', adminRole('school', 'A'), {
          role: 'STAFF',
          scope: 'school',
          schoolId: 'B',
          groupId: null,
          permissions: ['documents:read'],
        });
        givenUser(userRow('student-b', [['B', 'group']]));
        await expect(service.suspendUser('student-b', staffAdmin)).rejects.toBeInstanceOf(ForbiddenException);
      });
    });

    describe('level', () => {
      it('a school admin cannot suspend a user holding a platform-scoped role', async () => {
        givenUser(userRow('other-platform-admin', [['A', 'platform']]));
        await expect(service.suspendUser('other-platform-admin', adminA)).rejects.toThrow(
          new ForbiddenException('You cannot suspend a user with a higher-level role'),
        );
        expect(prisma.user.update).not.toHaveBeenCalled();
      });

      it('a school admin can suspend a peer school admin of the same school', async () => {
        givenUser(userRow('admin-a2', [['A', 'school']]));
        prisma.user.update.mockResolvedValue({ ...userRow('admin-a2', [['A', 'school']]), status: 'SUSPENDED' });
        await expect(service.suspendUser('admin-a2', adminA)).resolves.toMatchObject({ status: 'SUSPENDED' });
      });

      it('a platform admin can suspend another platform admin', async () => {
        givenUser(userRow('other-platform-admin', [['sys', 'platform']]));
        prisma.user.update.mockResolvedValue({ ...userRow('other-platform-admin', []), status: 'SUSPENDED' });
        await expect(service.suspendUser('other-platform-admin', platformAdmin)).resolves.toMatchObject({
          status: 'SUSPENDED',
        });
      });
    });
  });

  describe('legacy updateUser with status SUSPENDED', () => {
    it('applies the same rules: no self-suspension', async () => {
      givenUser(userRow('admin-a', [['A', 'school']]));
      await expect(service.updateUser('admin-a', { status: 'suspended' }, adminA)).rejects.toThrow(
        new ForbiddenException('You cannot suspend your own account'),
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('applies the same rules: no higher-level target, no user outside all the actor schools', async () => {
      givenUser(userRow('other-platform-admin', [['A', 'platform']]));
      await expect(service.updateUser('other-platform-admin', { status: 'SUSPENDED' }, adminA)).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      givenUser(userRow('mixed', [['A', 'group'], ['B', 'school']]));
      await expect(service.updateUser('mixed', { status: 'SUSPENDED' }, adminA)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('suspends and revokes the sessions when allowed', async () => {
      const row = userRow('student-a', [['A', 'group']]);
      givenUser(row);
      prisma.user.update.mockResolvedValue({ ...row, status: 'SUSPENDED' });

      const result = await service.updateUser('student-a', { status: 'SUSPENDED' }, adminA);

      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'student-a' }, data: { status: 'SUSPENDED' } });
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
        'student-a',
        'user_suspended',
        expect.anything(),
        SYSTEM_AUDIT_CONTEXT,
      );
      expect(result.status).toBe('SUSPENDED');
    });

    it('keeps the current behaviour for status ACTIVE (reactivation is #42)', async () => {
      const row = userRow('student-a', [['A', 'group']], 'SUSPENDED');
      givenUser(row);
      prisma.user.update.mockResolvedValue({ ...row, status: 'ACTIVE' });

      const result = await service.updateUser('student-a', { status: 'ACTIVE' }, adminA);

      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'student-a' }, data: { status: 'ACTIVE' } });
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
      expect(result.status).toBe('ACTIVE');
    });
  });
});
