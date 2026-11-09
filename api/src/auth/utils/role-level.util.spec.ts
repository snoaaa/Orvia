import { highestRoleLevel, roleScopeLevel } from './role-level.util.js';

describe('role level', () => {
  it('ranks platform above school above group', () => {
    expect(roleScopeLevel('platform')).toBeGreaterThan(roleScopeLevel('school'));
    expect(roleScopeLevel('school')).toBeGreaterThan(roleScopeLevel('group'));
    expect(roleScopeLevel('group')).toBeGreaterThan(0);
  });

  it('ranks an unknown scope lowest', () => {
    expect(roleScopeLevel('custom')).toBe(0);
  });

  it('takes the highest level of several roles', () => {
    expect(highestRoleLevel(['group', 'platform', 'school'])).toBe(roleScopeLevel('platform'));
    expect(highestRoleLevel(['group', 'school'])).toBe(roleScopeLevel('school'));
  });

  it('returns 0 when there are no roles', () => {
    expect(highestRoleLevel([])).toBe(0);
  });
});
