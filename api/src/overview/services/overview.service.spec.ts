import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { OverviewService } from './overview.service.js';

describe('OverviewService (Issue #93 — Role-Adapted Dashboard Summary)', () => {
  let service: OverviewService;
  let mockPrisma: any;

  const platformAdmin: AuthenticatedUser = {
    id: 'pa-1',
    email: 'admin@wamdp.platform',
    fullName: 'Platform Admin',
    status: 'ACTIVE',
    isPlatformAdmin: true,
    role: 'PLATFORM_ADMIN',
    roles: ['PLATFORM_ADMIN'],
    permissions: ['*'],
    schoolIds: [],
    sessionId: 'sess-pa',
    assignments: [
      {
        role: 'PLATFORM_ADMIN',
        scope: 'platform',
        schoolId: 'sys-school',
        groupId: null,
        permissions: ['*'],
      },
    ],
  };

  const schoolAdmin: AuthenticatedUser = {
    id: 'sa-1',
    email: 'admin.a@demo.test',
    fullName: 'School A Admin',
    status: 'ACTIVE',
    isPlatformAdmin: false,
    role: 'SCHOOL_ADMIN',
    roles: ['SCHOOL_ADMIN'],
    permissions: [
      'users:read',
      'users:suspend',
      'schools:read',
      'spaces:read',
      'documents:read',
      'audit:read',
      'metrics:view',
    ],
    schoolIds: ['school-a'],
    schoolId: 'school-a',
    sessionId: 'sess-sa',
    assignments: [
      {
        role: 'SCHOOL_ADMIN',
        scope: 'school',
        schoolId: 'school-a',
        groupId: null,
        permissions: [
          'users:read',
          'users:suspend',
          'schools:read',
          'spaces:read',
          'documents:read',
          'audit:read',
          'metrics:view',
        ],
      },
    ],
  };

  beforeEach(() => {
    mockPrisma = {
      user: {
        groupBy: vi.fn().mockResolvedValue([
          { status: 'ACTIVE', _count: 10 },
          { status: 'INVITED', _count: 2 },
        ]),
      },
      school: {
        groupBy: vi.fn().mockResolvedValue([{ status: 'active', _count: 3 }]),
        findMany: vi.fn().mockResolvedValue([{ id: 'school-a', name: 'Demo School A' }]),
      },
      session: {
        count: vi.fn().mockResolvedValue(5),
      },
      document: {
        count: vi.fn().mockResolvedValue(42),
      },
      space: {
        count: vi.fn().mockResolvedValue(4),
        findMany: vi.fn().mockResolvedValue([
          { id: 'sp-1', name: 'Computer Science', _count: { documents: 20 } },
        ]),
      },
      processingJob: {
        groupBy: vi.fn().mockResolvedValue([
          { status: 'completed', _count: 39 },
          { status: 'failed', _count: 3 },
        ]),
      },
      auditEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            seq: 101n,
            category: 'authentication',
            action: 'login_success',
            actorRole: 'SCHOOL_ADMIN',
            entityType: 'user',
            schoolId: 'school-a',
            createdAt: new Date('2026-11-20T01:00:00.000Z'),
          },
        ]),
        count: vi.fn().mockResolvedValue(2),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };

    service = new OverviewService(mockPrisma);
  });

  it('returns global figures with scope="platform" for a platform administrator', async () => {
    const res = await service.getOverview(platformAdmin, '7d');

    expect(res.scope).toBe('platform');
    expect(res.users?.total).toBe(12);
    expect(res.schools?.total).toBe(3);
    expect(res.documents?.total).toBe(42);
    expect(res.documents?.processingErrors).toBe(3);
    expect(res.alerts?.length).toBe(4);
    // Global query has empty user filter
    expect(mockPrisma.user.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('scopes all queries to the school admin schoolIds and sets scope="school"', async () => {
    const res = await service.getOverview(schoolAdmin, '7d');

    expect(res.scope).toBe('school');
    expect(res.users?.total).toBe(12);
    expect(res.documents?.spaces).toBe(4);
    expect(res.documents?.processingErrors).toBe(3);
    expect(res.recent?.[0]?.schoolName).toBe('Demo School A');

    // Verify user count is restricted to school-a
    expect(mockPrisma.user.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assignments: {
            some: expect.objectContaining({
              schoolId: { in: ['school-a'] },
            }),
          },
        },
      }),
    );

    // Verify documents count is restricted to school-a
    expect(mockPrisma.document.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          space: { schoolId: { in: ['school-a'] } },
        }),
      }),
    );
  });
});
