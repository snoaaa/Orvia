import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { isDocumentVisibleTo, matchingAccessRulesWhere, versionFiltersWhere, visibleDocumentsWhere } from './document-visibility.util.js';

const user = (assignments: { role: string; scope?: string; schoolId: string; permissions: string[] }[]) =>
  ({
    id: 'u1',
    isPlatformAdmin: assignments.some((a) => a.scope === 'platform'),
    schoolIds: [...new Set(assignments.map((a) => a.schoolId))],
    permissions: assignments.flatMap((a) => a.permissions),
    assignments: assignments.map((a) => ({ scope: 'school', groupId: null, ...a })),
  }) as unknown as AuthenticatedUser;

describe('document visibility (#109)', () => {
  it('lets platform admins see everything', () => {
    expect(visibleDocumentsWhere(user([{ role: 'PLATFORM_ADMIN', scope: 'platform', schoolId: '', permissions: ['*'] }]))).toBeUndefined();
  });

  it('matches school, role (per school), class or group membership and user rules, in the schools of the user', () => {
    const student = user([
      { role: 'STUDENT', schoolId: 's1', permissions: ['documents:read'] },
      { role: 'PARENT_GUEST', schoolId: 's2', permissions: ['documents:read'] },
    ]);
    expect(matchingAccessRulesWhere(student)).toEqual({
      schoolId: { in: ['s1', 's2'] },
      OR: [
        { targetType: 'school' },
        { targetType: 'role', schoolId: 's1', role: { name: { in: ['STUDENT'] } } },
        { targetType: 'role', schoolId: 's2', role: { name: { in: ['PARENT_GUEST'] } } },
        {
          targetType: { in: ['class', 'group'] },
          group: {
            deletedAt: null,
            OR: [{ members: { some: { userId: 'u1' } } }, { assignments: { some: { userId: 'u1', deletedAt: null } } }],
          },
        },
        { targetType: 'user', userId: 'u1' },
      ],
    });
  });

  it('a reader only sees published documents; a draft has no rule to match', () => {
    const where = visibleDocumentsWhere(user([{ role: 'STUDENT', schoolId: 's1', permissions: ['documents:read'] }]));
    expect(where?.OR).toHaveLength(1);
    expect(where?.OR?.[0]).toHaveProperty('access.some');
    // #111: and only once a version is processed
    expect(where?.OR?.[0]).toHaveProperty('versions', { some: { status: 'available' } });
  });

  it('a document manager also sees every document of the schools they manage', () => {
    const where = visibleDocumentsWhere(
      user([
        { role: 'CONTENT_MANAGER', schoolId: 's1', permissions: ['documents:manage'] },
        { role: 'STUDENT', schoolId: 's2', permissions: ['documents:read'] },
      ]),
    );
    expect(where?.OR?.[0]).toEqual({ space: { schoolId: { in: ['s1'] } } });
    expect(where?.OR?.[1]).toHaveProperty('access.some');
  });

  it('checks one live document in the database', async () => {
    const prisma = { document: { findFirst: vi.fn().mockResolvedValue(null) } };
    const reader = user([{ role: 'STAFF', schoolId: 's1', permissions: ['documents:read'] }]);
    expect(await isDocumentVisibleTo(prisma, reader, 'd1')).toBe(false);
    expect(prisma.document.findFirst).toHaveBeenCalledWith({
      where: { AND: [{ id: 'd1', deletedAt: null, space: { deletedAt: null } }, visibleDocumentsWhere(reader)] },
      select: { id: true },
    });

    prisma.document.findFirst.mockResolvedValue({ id: 'd1' });
    const admin = user([{ role: 'PLATFORM_ADMIN', scope: 'platform', schoolId: '', permissions: ['*'] }]);
    expect(await isDocumentVisibleTo(prisma, admin, 'd1')).toBe(true);
    expect(prisma.document.findFirst).toHaveBeenLastCalledWith({
      where: { AND: [{ id: 'd1', deletedAt: null, space: { deletedAt: null } }] },
      select: { id: true },
    });
  });
});

describe('versionFiltersWhere (#111)', () => {
  const pdf = { mimeType: { in: ['application/pdf'] } };
  const admin = user([{ role: 'PLATFORM_ADMIN', scope: 'platform', schoolId: '', permissions: ['*'] }]);
  const reader = user([{ role: 'STUDENT', schoolId: 's1', permissions: ['documents:read'] }]);
  const mixed = user([
    { role: 'CONTENT_MANAGER', schoolId: 's1', permissions: ['documents:manage'] },
    { role: 'PARENT_GUEST', schoolId: 's2', permissions: ['documents:read'] },
  ]);

  it('is undefined without status or type', () => {
    expect(versionFiltersWhere(reader)).toBeUndefined();
  });

  it('applies to the current version for platform admins', () => {
    expect(versionFiltersWhere(admin, 'ocr', 'pdf')).toEqual({ currentVersion: { status: 'ocr', ...pdf } });
  });

  it('applies to the available versions for readers, and matches nothing for a processing status', () => {
    expect(versionFiltersWhere(reader, 'available', 'pdf')).toEqual({
      OR: [{ versions: { some: { status: 'available', ...pdf } } }],
    });
    expect(versionFiltersWhere(reader, undefined, 'pdf')).toEqual({
      OR: [{ versions: { some: { status: 'available', ...pdf } } }],
    });
    expect(versionFiltersWhere(reader, 'ocr')).toEqual({ id: { in: [] } });
  });

  it('splits by school for someone who manages one school and reads in another', () => {
    expect(versionFiltersWhere(mixed, 'available')).toEqual({
      OR: [
        { space: { schoolId: { in: ['s1'] } }, currentVersion: { status: 'available' } },
        { space: { schoolId: { notIn: ['s1'] } }, versions: { some: { status: 'available' } } },
      ],
    });
    expect(versionFiltersWhere(mixed, 'error')).toEqual({
      OR: [{ space: { schoolId: { in: ['s1'] } }, currentVersion: { status: 'error' } }],
    });
  });
});
