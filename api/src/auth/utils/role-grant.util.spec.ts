import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../types/authenticated-user.js';
import { assertCanGrantRole, grantableRoleLevel } from './role-grant.util.js';

type Held = { scope: string; schoolId: string; permissions?: string[] };

const actor = (...held: Held[]) =>
  ({
    id: 'actor',
    assignments: held.map((h) => ({
      role: 'R',
      scope: h.scope,
      schoolId: h.schoolId,
      groupId: null,
      permissions: h.permissions ?? ['users:assign_role'],
    })),
  }) as unknown as AuthenticatedUser;

const PLATFORM_ROLE = { name: 'PLATFORM_ADMIN', scope: 'platform' };
const SCHOOL_ROLE = { name: 'SCHOOL_ADMIN', scope: 'school' };
const GROUP_ROLE = { name: 'STUDENT', scope: 'group' };

describe('grantableRoleLevel', () => {
  it('only counts roles that carry users:assign_role', () => {
    const user = actor({ scope: 'school', schoolId: 'a' }, { scope: 'platform', schoolId: 'sys', permissions: [] });
    expect(grantableRoleLevel(user)).toBe(2);
  });

  it('with a school, only counts platform roles and roles in that school', () => {
    const user = actor({ scope: 'school', schoolId: 'a' }, { scope: 'group', schoolId: 'b' });
    expect(grantableRoleLevel(user, 'a')).toBe(2);
    expect(grantableRoleLevel(user, 'b')).toBe(1);
    expect(grantableRoleLevel(user, 'c')).toBe(0);
    expect(grantableRoleLevel(actor({ scope: 'platform', schoolId: 'sys' }), 'c')).toBe(3);
  });

  it('is 0 without users:assign_role', () => {
    expect(grantableRoleLevel(actor({ scope: 'school', schoolId: 'a', permissions: ['users:read'] }))).toBe(0);
  });
});

describe('assertCanGrantRole', () => {
  it('lets a platform admin grant any role in any school', () => {
    const user = actor({ scope: 'platform', schoolId: 'sys' });
    for (const role of [PLATFORM_ROLE, SCHOOL_ROLE, GROUP_ROLE]) {
      expect(() => assertCanGrantRole(user, role, 'any')).not.toThrow();
    }
  });

  it('lets a school admin grant school and group roles in their own school', () => {
    const user = actor({ scope: 'school', schoolId: 'a' });
    expect(() => assertCanGrantRole(user, SCHOOL_ROLE, 'a')).not.toThrow();
    expect(() => assertCanGrantRole(user, GROUP_ROLE, 'a')).not.toThrow();
  });

  it('rejects a platform role for a school admin', () => {
    const user = actor({ scope: 'school', schoolId: 'a' });
    expect(() => assertCanGrantRole(user, PLATFORM_ROLE, 'a')).toThrow(
      new ForbiddenException('Only a platform administrator can assign the PLATFORM_ADMIN role'),
    );
  });

  it('rejects a role above the level the actor holds in that school', () => {
    const user = actor({ scope: 'group', schoolId: 'a' });
    expect(() => assertCanGrantRole(user, GROUP_ROLE, 'a')).not.toThrow();
    expect(() => assertCanGrantRole(user, SCHOOL_ROLE, 'a')).toThrow(/above your own level/);
  });

  it('rejects another school', () => {
    const user = actor({ scope: 'school', schoolId: 'a' });
    expect(() => assertCanGrantRole(user, GROUP_ROLE, 'b')).toThrow(ForbiddenException);
  });
});
