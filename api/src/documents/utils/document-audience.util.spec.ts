import { describe, expect, it, vi } from 'vitest';
import { audienceChange, audienceOf, documentManagerIds } from './document-audience.util.js';

const db = (...results: { id: string }[][]) => {
  const findMany = vi.fn();
  for (const r of results) findMany.mockResolvedValueOnce(r);
  return { user: { findMany } };
};

describe('document audience (#110)', () => {
  it('reaches nobody without rules, without querying', async () => {
    const client = db();
    expect(await audienceOf(client as never, 's1', [])).toEqual(new Set());
    expect(client.user.findMany).not.toHaveBeenCalled();
  });

  it('builds one query: users of the school reached by a school, role, group or user rule', async () => {
    const client = db([{ id: 'u1' }]);
    const result = await audienceOf(client as never, 's1', [
      { targetType: 'role', roleId: 'r1' },
      { targetType: 'class', groupId: 'g1' },
      { targetType: 'group', groupId: 'g2' },
      { targetType: 'user', userId: 'u9' },
    ]);
    expect(result).toEqual(new Set(['u1']));
    const liveGroups = { id: { in: ['g1', 'g2'] }, deletedAt: null };
    expect(client.user.findMany).toHaveBeenCalledWith({
      where: {
        assignments: { some: { schoolId: 's1', deletedAt: null } },
        OR: [
          { assignments: { some: { schoolId: 's1', deletedAt: null, roleId: { in: ['r1'] } } } },
          { groupMemberships: { some: { group: liveGroups } } },
          { assignments: { some: { deletedAt: null, group: liveGroups } } },
          { id: { in: ['u9'] } },
        ],
      },
      select: { id: true },
    });
  });

  it('a school rule reaches everyone with a role in the school', async () => {
    const client = db([]);
    await audienceOf(client as never, 's1', [{ targetType: 'school' }, { targetType: 'user', userId: 'u9' }]);
    expect(client.user.findMany.mock.calls[0][0].where).toEqual({ assignments: { some: { schoolId: 's1', deletedAt: null } } });
  });

  it('finds the managers among some users: platform roles, or a document-management permission in the school', async () => {
    const client = db([{ id: 'u2' }]);
    expect(await documentManagerIds(client as never, 's1', ['u1', 'u2'])).toEqual(new Set(['u2']));
    const where = client.user.findMany.mock.calls[0][0].where;
    expect(where.id).toEqual({ in: ['u1', 'u2'] });
    const [platform, school] = where.assignments.some.OR;
    expect(platform).toEqual({ role: { scope: 'platform' } });
    expect(school.schoolId).toBe('s1');
    expect(school.role.rolePermissions.some.permission.code.in).toEqual(expect.arrayContaining(['*', 'documents:manage', 'documents:update']));
    expect(school.role.rolePermissions.some.permission.code.in).not.toContain('documents:read');
  });

  it('returns who lost and who gained the document, without the managers', async () => {
    // before: u1 u2 u3 / after: u2 u4 u5 / managers among u1 u3 u4 u5: u3, u5
    const client = db([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }], [{ id: 'u2' }, { id: 'u4' }, { id: 'u5' }], [{ id: 'u3' }, { id: 'u5' }]);
    expect(await audienceChange(client as never, 's1', [{ targetType: 'school' }], [{ targetType: 'user', userId: 'u4' }])).toEqual({
      lost: ['u1'],
      gained: ['u4'],
    });
  });
});
