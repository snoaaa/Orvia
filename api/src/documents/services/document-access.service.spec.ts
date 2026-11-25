import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../audit/services/audit.service.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { DocumentAccessTargetDto } from '../dto/index.js';
import { audienceChange } from '../utils/document-audience.util.js';
import { DocumentAccessService } from './document-access.service.js';

vi.mock('../utils/document-audience.util.js', () => ({ audienceChange: vi.fn() }));

const manager = (scope: 'platform' | 'school' = 'school') =>
  ({
    id: 'actor',
    role: 'CONTENT_MANAGER',
    schoolId: 'school-a',
    isPlatformAdmin: scope === 'platform',
    schoolIds: ['school-a'],
    permissions: ['documents:manage'],
    assignments: [{ role: 'CONTENT_MANAGER', scope, schoolId: 'school-a', groupId: null, permissions: ['documents:manage'] }],
  }) as unknown as AuthenticatedUser;

const stored = (id: string, targetType: string, targetId: string, extra: Record<string, string> = {}) => ({
  id,
  targetType,
  targetId,
  roleId: null,
  groupId: null,
  userId: null,
  ...extra,
});

describe('DocumentAccessService (#109, #110)', () => {
  const prisma = {
    document: { findUnique: vi.fn() },
    documentAccess: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    documentVersion: { count: vi.fn() },
    syncChange: { createMany: vi.fn() },
    offlineSelection: { deleteMany: vi.fn() },
    role: { findMany: vi.fn() },
    group: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  const audit = { record: vi.fn() };
  const service = new DocumentAccessService(prisma as unknown as PrismaService, audit as unknown as AuditService);
  const add = (rules: DocumentAccessTargetDto[], actor = manager()) => service.addRules('doc-1', { rules }, actor);
  const replace = (rules: DocumentAccessTargetDto[], actor = manager()) => service.replaceRules('doc-1', { rules }, actor);
  const rows = () => prisma.documentAccess.createMany.mock.calls.flatMap(([args]) => args.data);
  /** The rules written. */
  const created = rows;
  /** Current rules of the document, as read inside the transaction. */
  let current: ReturnType<typeof stored>[];

  beforeEach(() => {
    vi.resetAllMocks();
    current = [];
    prisma.$transaction.mockImplementation((run: (tx: typeof prisma) => Promise<unknown>) => run(prisma));
    prisma.$queryRaw.mockResolvedValue([{ id: 'doc-1' }]);
    prisma.document.findUnique.mockResolvedValue({
      id: 'doc-1',
      spaceId: 'space-1',
      deletedAt: null,
      space: { schoolId: 'school-a' },
    });
    // Inside the transaction (select) the current rules; afterwards (include) the rules returned to the caller.
    prisma.documentAccess.findMany.mockImplementation(async (args: { select?: unknown }) => (args.select ? current : []));
    prisma.role.findMany.mockResolvedValue([
      { id: 'role-staff', scope: 'school' },
      { id: 'role-platform', scope: 'platform' },
    ]);
    prisma.group.findMany.mockResolvedValue([
      { id: 'group-6a', type: 'class' },
      { id: 'group-science', type: 'department' },
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: 'user-parent' }]);
    vi.mocked(audienceChange).mockResolvedValue({ lost: [], gained: [] });
    prisma.documentVersion.count.mockResolvedValue(1); // the document has an available version
  });

  describe('adding (#109)', () => {
    it('stores each kind of target with the school of the document and the matching column', async () => {
      await add([
        { type: 'school', id: 'school-a' },
        { type: 'role', id: 'role-staff' },
        { type: 'class', id: 'group-6a' },
        { type: 'group', id: 'group-science' },
        { type: 'user', id: 'user-parent' },
      ]);
      const base = { documentId: 'doc-1', schoolId: 'school-a' };
      expect(created()).toEqual([
        { ...base, targetType: 'school', targetId: 'school-a' },
        { ...base, targetType: 'role', targetId: 'role-staff', roleId: 'role-staff' },
        { ...base, targetType: 'class', targetId: 'group-6a', groupId: 'group-6a' },
        { ...base, targetType: 'group', targetId: 'group-science', groupId: 'group-science' },
        { ...base, targetType: 'user', targetId: 'user-parent', userId: 'user-parent' },
      ]);
      // No made-up creation times: rules added together share the database's time (listed by created_at, then id).
      expect(rows().some((r: Record<string, unknown>) => 'createdAt' in r)).toBe(false);
    });

    it('only looks up groups of the document school that are not deleted, and users with a role there', async () => {
      await add([
        { type: 'class', id: 'group-6a' },
        { type: 'user', id: 'user-parent' },
      ]);
      expect(prisma.group.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['group-6a'] }, schoolId: 'school-a', deletedAt: null });
      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
        id: { in: ['user-parent'] },
        assignments: { some: { schoolId: 'school-a', deletedAt: null } },
      });
      expect(prisma.role.findMany).not.toHaveBeenCalled();
    });

    it('stores a class sent as a group as a class, and repeated targets once', async () => {
      await add([
        { type: 'group', id: 'group-6a' },
        { type: 'class', id: 'group-6a' },
      ]);
      expect(created()).toEqual([expect.objectContaining({ targetType: 'class', targetId: 'group-6a' })]);
    });

    it.each([
      [{ type: 'school', id: 'school-b' }, 'is not the school of this document'],
      [{ type: 'role', id: 'role-unknown' }, 'not found'],
      [{ type: 'role', id: 'role-platform' }, 'is a platform role'],
      [{ type: 'class', id: 'group-other-school' }, "is not a group of the document's school"],
      [{ type: 'class', id: 'group-science' }, 'is not a class'],
      [{ type: 'user', id: 'user-elsewhere' }, "has no role in the document's school"],
    ] as [DocumentAccessTargetDto, string][])('rejects %j with 400 before writing anything', async (rule, message) => {
      const error = await add([{ type: 'school', id: 'school-a' }, rule]).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toContain(message);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('skips targets the document already has and audits only the new ones', async () => {
      current = [stored('r1', 'school', 'school-a')];
      await add([
        { type: 'school', id: 'school-a' },
        { type: 'role', id: 'role-staff' },
      ]);
      expect(created()).toEqual([expect.objectContaining({ targetType: 'role', targetId: 'role-staff' })]);
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record.mock.calls[0][1]).toBe(prisma); // inside the transaction
      expect(audit.record.mock.calls[0][0]).toMatchObject({
        action: 'document_published',
        entity: { type: 'document', id: 'doc-1' },
        details: { schoolId: 'school-a', spaceId: 'space-1', rules: [{ type: 'role', targetId: 'role-staff' }] },
      });
    });

    it('fails, and so rolls the new rules back, when the audit event cannot be stored', async () => {
      audit.record.mockRejectedValue(new Error('audit down'));
      await expect(add([{ type: 'school', id: 'school-a' }])).rejects.toThrow('audit down');
      expect(prisma.documentAccess.createMany).toHaveBeenCalledTimes(1);
    });

    it('writes and records nothing when every target was already there', async () => {
      current = [stored('r1', 'school', 'school-a')];
      await add([{ type: 'school', id: 'school-a' }]);
      expect(prisma.documentAccess.createMany).not.toHaveBeenCalled();
      expect(audienceChange).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('tells the mobile app who gained the document', async () => {
      vi.mocked(audienceChange).mockResolvedValue({ lost: [], gained: ['u1', 'u2'] });
      await add([{ type: 'role', id: 'role-staff' }]);
      expect(audienceChange).toHaveBeenCalledWith(prisma, 'school-a', [], [expect.objectContaining({ targetType: 'role' })]);
      expect(prisma.syncChange.createMany).toHaveBeenCalledWith({
        data: [
          { userId: 'u1', entityType: 'document', entityId: 'doc-1', operation: 'insert' },
          { userId: 'u2', entityType: 'document', entityId: 'doc-1', operation: 'insert' },
        ],
      });
      expect(prisma.offlineSelection.deleteMany).not.toHaveBeenCalled();
    });
  });

  it('does not notify phones about a document that is still processing (#112)', async () => {
    prisma.documentVersion.count.mockResolvedValue(0);
    vi.mocked(audienceChange).mockResolvedValue({ lost: ['u1'], gained: ['u2'] });
    await add([{ type: 'role', id: 'role-staff' }]);
    expect(prisma.documentVersion.count).toHaveBeenCalledWith({ where: { documentId: 'doc-1', status: 'available' } });
    expect(audienceChange).not.toHaveBeenCalled();
    expect(prisma.syncChange.createMany).not.toHaveBeenCalled();
    expect(created()).toHaveLength(1);
  });

  describe('replacing (#110)', () => {
    beforeEach(() => {
      current = [stored('r1', 'school', 'school-a'), stored('r2', 'class', 'group-6a', { groupId: 'group-6a' })];
    });

    it('removes the targets not listed, adds the new ones and keeps the others', async () => {
      await replace([
        { type: 'class', id: 'group-6a' },
        { type: 'user', id: 'user-parent' },
      ]);
      expect(prisma.documentAccess.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['r1'] } } });
      expect(created()).toEqual([expect.objectContaining({ targetType: 'user', targetId: 'user-parent' })]);
      expect(audit.record.mock.calls[0][0]).toMatchObject({
        action: 'document_access_changed',
        details: {
          schoolId: 'school-a',
          added: [{ type: 'user', targetId: 'user-parent' }],
          removed: [{ type: 'school', targetId: 'school-a' }],
        },
      });
    });

    it('an empty list removes every rule (draft)', async () => {
      await replace([]);
      expect(prisma.documentAccess.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['r1', 'r2'] } } });
      expect(audienceChange).toHaveBeenCalledWith(prisma, 'school-a', current, []);
    });

    it('the same list changes and records nothing', async () => {
      await replace([
        { type: 'school', id: 'school-a' },
        { type: 'group', id: 'group-6a' },
      ]);
      expect(prisma.documentAccess.deleteMany).not.toHaveBeenCalled();
      expect(prisma.documentAccess.createMany).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('marks the readers who lost the document and drops it from their offline selections', async () => {
      vi.mocked(audienceChange).mockResolvedValue({ lost: ['u1'], gained: ['u2'] });
      await replace([{ type: 'class', id: 'group-6a' }]);
      expect(prisma.syncChange.createMany).toHaveBeenCalledWith({
        data: [
          { userId: 'u1', entityType: 'document', entityId: 'doc-1', operation: 'delete' },
          { userId: 'u2', entityType: 'document', entityId: 'doc-1', operation: 'insert' },
        ],
      });
      expect(prisma.offlineSelection.deleteMany).toHaveBeenCalledWith({
        where: { documentId: 'doc-1', device: { userId: { in: ['u1'] } } },
      });
    });

    it('validates the targets before locking anything', async () => {
      await expect(replace([{ type: 'school', id: 'school-b' }])).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('removing one rule (#110)', () => {
    beforeEach(() => {
      current = [stored('r1', 'school', 'school-a'), stored('r2', 'role', 'role-staff', { roleId: 'role-staff' })];
    });

    it('deletes the rule and records it', async () => {
      await service.removeRule('doc-1', 'r2', manager());
      expect(prisma.documentAccess.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['r2'] } } });
      expect(audienceChange).toHaveBeenCalledWith(prisma, 'school-a', current, [current[0]]);
      expect(audit.record.mock.calls[0][0]).toMatchObject({
        action: 'document_access_changed',
        details: { added: [], removed: [{ type: 'role', targetId: 'role-staff' }] },
      });
    });

    it('answers 404 for a rule that is not one of this document', async () => {
      await expect(service.removeRule('doc-1', 'r9', manager())).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.documentAccess.deleteMany).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('options of a document (#117)', () => {
    beforeEach(() => {
      prisma.school = { findUnique: vi.fn().mockResolvedValue({ id: 'school-a', name: 'Lycée A' }) };
      prisma.role.findMany.mockResolvedValue([
        { id: 'role-staff', name: 'STAFF' },
        { id: 'role-student', name: 'STUDENT' },
      ]);
      prisma.group.findMany.mockResolvedValue([
        { id: 'group-6a', name: '6e A', type: 'class' },
        { id: 'group-science', name: 'Sciences', type: 'department' },
        { id: 'group-team', name: 'Sport', type: 'team' },
      ]);
    });

    it('lists the school, the non-platform roles, the classes and the other groups', async () => {
      const options = await service.listOptions('doc-1', manager());
      expect(options.school).toMatchObject({ id: 'school-a', name: 'Lycée A' });
      expect(options.roles.map((r) => r.name)).toEqual(['STAFF', 'STUDENT']);
      expect(options.classes.map((g) => g.name)).toEqual(['6e A']);
      expect(options.groups.map((g) => g.name)).toEqual(['Sciences', 'Sport']);
    });

    it('excludes platform roles and deleted groups, and only reads the school of the document', async () => {
      await service.listOptions('doc-1', manager());
      expect(prisma.role.findMany.mock.calls[0][0]).toMatchObject({ where: { scope: { not: 'platform' } } });
      expect(prisma.group.findMany.mock.calls[0][0]).toMatchObject({ where: { schoolId: 'school-a', deletedAt: null } });
    });

    it('answers 404 for a missing document and 403 for a document of another school', async () => {
      prisma.document.findUnique.mockResolvedValueOnce(null);
      await expect(service.listOptions('doc-1', manager())).rejects.toBeInstanceOf(NotFoundException);
      prisma.document.findUnique.mockResolvedValueOnce({
        id: 'doc-1',
        spaceId: 'space-1',
        deletedAt: null,
        space: { schoolId: 'school-b' },
      });
      await expect(service.listOptions('doc-1', manager())).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('answers 404 with NotFoundException if the school is missing instead of Prisma P2025', async () => {
      prisma.school.findUnique.mockResolvedValueOnce(null);
      await expect(service.listOptions('doc-1', manager())).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('locking and access', () => {
    it('locks the live document row before reading its rules', async () => {
      await add([{ type: 'school', id: 'school-a' }]);
      const sql = prisma.$queryRaw.mock.calls[0][0].join('?');
      expect(sql).toContain('FOR UPDATE');
      expect(sql).toContain('deleted_at IS NULL');
      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.documentAccess.findMany.mock.invocationCallOrder[0]);
    });

    it('answers 404 when the document is deleted while waiting for the lock', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      await expect(service.removeRule('doc-1', 'r1', manager())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('answers with all the rules and their target names', async () => {
      const createdAt = new Date();
      prisma.documentAccess.findMany.mockResolvedValue([
        { id: 'r1', documentId: 'doc-1', targetType: 'school', targetId: 'school-a', createdAt, school: { name: 'Lycée A' } },
        { id: 'r2', documentId: 'doc-1', targetType: 'class', targetId: 'group-6a', createdAt, group: { name: '6e A' } },
        { id: 'r3', documentId: 'doc-1', targetType: 'user', targetId: 'user-parent', createdAt, user: { fullName: 'Parent P' } },
        { id: 'r4', documentId: 'doc-1', targetType: 'role', targetId: 'role-staff', createdAt, role: null },
      ]);
      const rules = await service.listRules('doc-1', manager());
      expect(rules.map((r) => [r.type, r.targetName])).toEqual([
        ['school', 'Lycée A'],
        ['class', '6e A'],
        ['user', 'Parent P'],
        ['role', null],
      ]);
      expect(prisma.documentAccess.findMany.mock.calls[0][0]).toMatchObject({
        where: { documentId: 'doc-1' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
    });

    it('answers 404 for a missing or deleted document', async () => {
      prisma.document.findUnique.mockResolvedValueOnce(null);
      await expect(service.listRules('doc-1', manager())).rejects.toBeInstanceOf(NotFoundException);
      prisma.document.findUnique.mockResolvedValueOnce({ id: 'doc-1', deletedAt: new Date(), space: { schoolId: 'school-a', deletedAt: null } });
      await expect(replace([])).rejects.toBeInstanceOf(NotFoundException);
      prisma.document.findUnique.mockResolvedValueOnce({ id: 'doc-1', deletedAt: null, space: { schoolId: 'school-a', deletedAt: new Date() } });
      await expect(service.listRules('doc-1', manager())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('answers 403 for a document of a school the actor does not manage; a platform admin manages all', async () => {
      prisma.document.findUnique.mockResolvedValue({ id: 'doc-1', spaceId: 'space-1', deletedAt: null, space: { schoolId: 'school-b' } });
      await expect(service.removeRule('doc-1', 'r1', manager())).rejects.toBeInstanceOf(ForbiddenException);
      await add([{ type: 'school', id: 'school-b' }], manager('platform'));
      expect(created()).toEqual([expect.objectContaining({ schoolId: 'school-b', targetId: 'school-b' })]);
    });
  });
});
