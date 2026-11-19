import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../audit/services/audit.service.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { DocumentAccessTargetDto } from '../dto/index.js';
import { DocumentAccessService } from './document-access.service.js';

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

describe('DocumentAccessService (#109)', () => {
  const prisma = {
    document: { findUnique: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    documentAccess: { createMany: vi.fn(), findMany: vi.fn() },
    role: { findMany: vi.fn() },
    group: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  };
  const audit = { record: vi.fn() };
  const service = new DocumentAccessService(prisma as unknown as PrismaService, audit as unknown as AuditService);
  const add = (rules: DocumentAccessTargetDto[], actor = manager()) => service.addRules('doc-1', { rules }, actor);
  const created = () => prisma.documentAccess.createMany.mock.calls.flatMap(([args]) => args.data);

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.$transaction.mockImplementation((run: (tx: typeof prisma) => Promise<unknown>) => run(prisma));
    prisma.$queryRaw.mockResolvedValue([{ id: 'doc-1' }]);
    prisma.document.findUnique.mockResolvedValue({
      id: 'doc-1',
      spaceId: 'space-1',
      deletedAt: null,
      space: { schoolId: 'school-a' },
    });
    prisma.role.findMany.mockResolvedValue([
      { id: 'role-staff', scope: 'school' },
      { id: 'role-platform', scope: 'platform' },
    ]);
    prisma.group.findMany.mockResolvedValue([
      { id: 'group-6a', type: 'class' },
      { id: 'group-science', type: 'department' },
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: 'user-parent' }]);
    prisma.documentAccess.findMany.mockResolvedValue([]);
  });

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
    expect(prisma.documentAccess.createMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('skips targets the document already has and audits only the new ones, in the same transaction', async () => {
    prisma.documentAccess.findMany.mockResolvedValueOnce([{ targetType: 'school', targetId: 'school-a' }]);
    await add([
      { type: 'school', id: 'school-a' },
      { type: 'role', id: 'role-staff' },
    ]);
    expect(prisma.$queryRaw.mock.calls[0][0].join('?')).toContain('FOR UPDATE');
    expect(created()).toEqual([expect.objectContaining({ targetType: 'role', targetId: 'role-staff' })]);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][1]).toBe(prisma);
    expect(audit.record.mock.calls[0][0]).toMatchObject({
      action: 'document_published',
      entity: { type: 'document', id: 'doc-1' },
      details: { schoolId: 'school-a', spaceId: 'space-1', rules: [{ type: 'role', targetId: 'role-staff' }] },
    });
  });

  it('records nothing when every target was already there', async () => {
    prisma.documentAccess.findMany.mockResolvedValueOnce([{ targetType: 'school', targetId: 'school-a' }]);
    await add([{ type: 'school', id: 'school-a' }]);
    expect(prisma.documentAccess.createMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('does not hide database errors, and records nothing when the rules cannot be stored', async () => {
    prisma.documentAccess.createMany.mockRejectedValue(new Error('db down'));
    await expect(add([{ type: 'school', id: 'school-a' }])).rejects.toThrow('db down');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('fails, and so rolls the new rules back, when the audit event cannot be stored', async () => {
    audit.record.mockRejectedValue(new Error('audit down'));
    await expect(add([{ type: 'school', id: 'school-a' }])).rejects.toThrow('audit down');
    expect(prisma.documentAccess.createMany).toHaveBeenCalledTimes(1);
  });

  it('answers 404 when the document is deleted while publishing', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    await expect(add([{ type: 'school', id: 'school-a' }])).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.documentAccess.createMany).not.toHaveBeenCalled();
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
    prisma.document.findUnique.mockResolvedValueOnce({ id: 'doc-1', deletedAt: new Date(), space: { schoolId: 'school-a' } });
    await expect(add([{ type: 'school', id: 'school-a' }])).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers 403 for a document of a school the actor does not manage; a platform admin manages all', async () => {
    prisma.document.findUnique.mockResolvedValue({ id: 'doc-1', spaceId: 'space-1', deletedAt: null, space: { schoolId: 'school-b' } });
    await expect(add([{ type: 'school', id: 'school-b' }])).rejects.toBeInstanceOf(ForbiddenException);
    await add([{ type: 'school', id: 'school-b' }], manager('platform'));
    expect(created()).toEqual([expect.objectContaining({ schoolId: 'school-b', targetId: 'school-b' })]);
  });
});
