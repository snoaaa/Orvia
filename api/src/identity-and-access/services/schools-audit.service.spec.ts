import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { IdentityAndAccessService } from './identity-and-access.service.js';

/**
 * School audit hooks (#50): every school operation records exactly one `identity_access` row with the
 * actor, target school scope, and the before/after values, and a call that changes nothing records nothing.
 */
describe('IdentityAndAccessService - school audit (#50)', () => {
  const actorWith = (scope: 'platform' | 'school'): AuthenticatedUser =>
    ({
      id: 'actor',
      email: 'actor@platform.edu',
      fullName: 'Actor',
      status: 'ACTIVE',
      isPlatformAdmin: scope === 'platform',
      permissions: ['schools:create', 'schools:update', 'schools:delete'],
      schoolIds: ['school-1'],
      assignments: [
        {
          role: scope === 'platform' ? 'PLATFORM_ADMIN' : 'SCHOOL_ADMIN',
          scope,
          schoolId: 'school-1',
          schoolStatus: 'active',
          groupId: null,
          permissions: ['schools:create', 'schools:update', 'schools:delete'],
        },
      ],
      role: scope === 'platform' ? 'PLATFORM_ADMIN' : 'SCHOOL_ADMIN',
      schoolId: 'school-1',
      sessionId: null,
    }) as AuthenticatedUser;
  const platformAdmin = actorWith('platform');

  const schoolRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'school-1',
    name: 'Demo School',
    status: 'active',
    allowedDomains: 'demo.edu',
    settings: { maxStudents: 500 },
    domains: [{ domain: 'demo.edu' }],
    createdAt: new Date('2026-11-01T10:00:00.000Z'),
    updatedAt: new Date('2026-11-01T10:00:00.000Z'),
    ...overrides,
  });

  function setup() {
    const prisma = {
      school: {
        findUnique: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        update: vi.fn(),
      },
      schoolDomain: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([{ domain: 'demo.edu' }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'school-1' }]),
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new IdentityAndAccessService(
      prisma as never,
      audit as never,
      {} as never,
      {} as never,
    );
    return { service, prisma, audit };
  }

  it('records the creation with before: null and the starting snapshot', async () => {
    const { service, prisma, audit } = setup();
    prisma.school.create.mockResolvedValueOnce(schoolRow({ id: 'new-school' }));

    await service.createSchool({ name: 'Demo School', allowedDomains: 'demo.edu' }, platformAdmin);

    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'identity_access',
        action: 'school_created',
        actor: { userId: 'actor', role: 'PLATFORM_ADMIN', schoolId: 'new-school' },
        entity: { type: 'school', id: 'new-school' },
        details: {
          schoolId: 'new-school',
          school: 'Demo School',
          before: null,
          after: { name: 'Demo School', status: 'active', domains: ['demo.edu'], settings: { maxStudents: 500 } },
        },
      }),
      prisma,
    );
  });

  it('normalizes missing settings to null in school_created snapshot', async () => {
    const { service, prisma, audit } = setup();
    prisma.school.create.mockResolvedValueOnce(schoolRow({ id: 'new-school', settings: undefined }));

    await service.createSchool({ name: 'Demo School', allowedDomains: 'demo.edu' }, platformAdmin);

    expect(audit.record.mock.calls[0][0].details.after.settings).toBeNull();
  });

  it('records only the fields an edit really changed, once', async () => {
    const { service, prisma, audit } = setup();
    prisma.school.findUnique.mockResolvedValueOnce(schoolRow());
    prisma.school.update.mockResolvedValueOnce(schoolRow({ name: 'Renamed School', settings: { maxStudents: 900 } }));

    await service.updateSchool('school-1', { name: 'Renamed School', settings: { maxStudents: 900 } }, platformAdmin);

    expect(audit.record).toHaveBeenCalledTimes(1);
    const event = audit.record.mock.calls[0][0];
    expect(event).toMatchObject({
      action: 'school_updated',
      actor: { userId: 'actor', role: 'PLATFORM_ADMIN', schoolId: 'school-1' },
      entity: { type: 'school', id: 'school-1' },
    });
    expect(event.details.schoolId).toBe('school-1');
    expect(event.details.changes).toEqual({
      name: { before: 'Demo School', after: 'Renamed School' },
      settings: { before: { maxStudents: 500 }, after: { maxStudents: 900 } },
    });
    expect(event.details.changes).not.toHaveProperty('domains');
  });

  it('records the domain replacement as a domains change, not as domain events', async () => {
    const { service, prisma, audit } = setup();
    prisma.school.findUnique.mockResolvedValueOnce(schoolRow());
    prisma.school.update.mockResolvedValueOnce(
      schoolRow({ allowedDomains: 'new.edu', domains: [{ domain: 'new.edu' }] }),
    );

    await service.updateSchool('school-1', { allowedDomains: 'new.edu' }, platformAdmin);

    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][0]).toMatchObject({
      action: 'school_updated',
      details: { changes: { domains: { before: ['demo.edu'], after: ['new.edu'] } } },
    });
  });

  it('writes nothing when the edit changes nothing', async () => {
    const { service, prisma, audit } = setup();
    prisma.school.findUnique.mockResolvedValueOnce(schoolRow());
    prisma.school.update.mockResolvedValueOnce(schoolRow());

    await service.updateSchool('school-1', { name: 'Demo School', settings: { maxStudents: 500 } }, platformAdmin);

    expect(audit.record).not.toHaveBeenCalled();
  });

  it('records the status transition once and skips a repeated call', async () => {
    const { service, prisma, audit } = setup();
    prisma.school.findUnique.mockResolvedValueOnce(schoolRow({ status: 'active' }));
    prisma.school.update.mockResolvedValueOnce(schoolRow({ status: 'deactivated' }));

    await service.deactivateSchool('school-1', platformAdmin);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'school_deactivated',
        actor: { userId: 'actor', role: 'PLATFORM_ADMIN', schoolId: 'school-1' },
        details: {
          schoolId: 'school-1',
          school: 'Demo School',
          changes: { status: { before: 'active', after: 'deactivated' } },
        },
      }),
      prisma,
    );

    // Already deactivated: the endpoint succeeds without updating or writing a second row.
    prisma.school.findUnique.mockResolvedValueOnce(schoolRow({ status: 'deactivated' }));
    await service.deactivateSchool('school-1', platformAdmin);

    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(prisma.school.update).toHaveBeenCalledTimes(1);
  });

  it('records a reactivation with its own action', async () => {
    const { service, prisma, audit } = setup();
    prisma.school.findUnique.mockResolvedValueOnce(schoolRow({ status: 'deactivated' }));
    prisma.school.update.mockResolvedValueOnce(schoolRow({ status: 'active' }));

    await service.reactivateSchool('school-1', platformAdmin);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'school_reactivated',
        actor: { userId: 'actor', role: 'PLATFORM_ADMIN', schoolId: 'school-1' },
        details: {
          schoolId: 'school-1',
          school: 'Demo School',
          changes: { status: { before: 'deactivated', after: 'active' } },
        },
      }),
      prisma,
    );
  });
});
