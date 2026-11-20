import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { DocumentVersionStatus } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/**
 * GET /documents (#111): each role gets exactly its scope, readers never see documents still in
 * processing, and the filters (space, title, tags, status, type) and pagination work together.
 */
describe('Document list (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const stamp = Date.now();
  const tag = `L${stamp}`;
  const schools = { A: '', B: '' };
  const spaces = { A1: '', A2: '', B: '' };
  const ids: Record<string, string> = {};
  const roles: Record<string, string> = {};
  const docs: Record<string, string> = {};
  let classA = '';
  let platformAdminId: string;

  const http = () => request(app.getHttpServer());
  const bearer = async (id: string) => `Bearer ${(await tokens.issueAccessToken(id)).accessToken}`;
  const list = async (as: string, query: Record<string, string | number> = {}) =>
    http()
      .get('/documents')
      .query({ limit: 100, ...query })
      .set('Authorization', await bearer(as));
  /** Asserts the HTTP status (with the body in the failure message) and returns the response. */
  const check = <T extends { status: number; body: unknown }>(res: T, status: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    return res;
  };
  /** Keys of the documents of this suite in a list answer, sorted. */
  const keysOf = (body: { data: { id: string }[] }) => {
    const keyById = Object.fromEntries(Object.entries(docs).map(([k, v]) => [v, k]));
    return body.data.map((d) => keyById[d.id]).filter(Boolean).sort();
  };
  const seen = async (as: string, query: Record<string, string | number> = {}) =>
    keysOf(check(await list(as, { q: tag, ...query }), 200).body);

  /** A document whose current version has `status` and `mimeType`, published by `rules`. */
  async function document(
    key: string,
    space: keyof typeof spaces,
    o: { status?: DocumentVersionStatus; mimeType?: string; tags?: string; rules?: { targetType: string; targetId: string; roleId?: string; groupId?: string; userId?: string }[]; previous?: DocumentVersionStatus } = {},
  ) {
    const school = space === 'B' ? schools.B : schools.A;
    const doc = await prisma.document.create({
      data: { spaceId: spaces[space], title: `${tag} ${key}`, tags: o.tags ?? '' },
    });
    if (o.previous) {
      await prisma.documentVersion.create({
        data: { documentId: doc.id, versionNo: 1, storageKey: `k-${doc.id}-1`, mimeType: 'application/pdf', checksum: 'c1', status: o.previous },
      });
    }
    const version = await prisma.documentVersion.create({
      data: {
        documentId: doc.id,
        versionNo: o.previous ? 2 : 1,
        storageKey: `k-${doc.id}`,
        mimeType: o.mimeType ?? 'application/pdf',
        checksum: 'c',
        status: o.status ?? 'available',
      },
    });
    await prisma.document.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
    for (const rule of o.rules ?? []) {
      await prisma.documentAccess.create({ data: { documentId: doc.id, schoolId: school, ...rule } });
    }
    docs[key] = doc.id;
  }

  async function user(key: string, school: keyof typeof schools, roleName: string) {
    const created = await prisma.user.create({
      data: { email: `e2e-doclist-${key.toLowerCase()}-${stamp}@school.edu`, fullName: key, status: 'ACTIVE' },
    });
    await prisma.userAssignment.create({ data: { userId: created.id, schoolId: schools[school], roleId: roles[roleName] } });
    ids[key] = created.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    for (const role of await prisma.role.findMany()) roles[role.name] = role.id;
    schools.A = (await prisma.school.create({ data: { name: `Test E2E DocList School A ${stamp}` } })).id;
    schools.B = (await prisma.school.create({ data: { name: `Test E2E DocList School B ${stamp}` } })).id;
    spaces.A1 = (await prisma.space.create({ data: { schoolId: schools.A, name: `${tag} A1` } })).id;
    spaces.A2 = (await prisma.space.create({ data: { schoolId: schools.A, name: `${tag} A2` } })).id;
    spaces.B = (await prisma.space.create({ data: { schoolId: schools.B, name: `${tag} B` } })).id;
    classA = (await prisma.group.create({ data: { schoolId: schools.A, name: `${tag} 6e A`, type: 'class' } })).id;

    await user('AdminA', 'A', 'SCHOOL_ADMIN');
    await user('ManagerA', 'A', 'CONTENT_MANAGER');
    await user('StaffA', 'A', 'STAFF');
    await user('StudentA', 'A', 'STUDENT');
    await user('ParentA', 'A', 'PARENT_GUEST');
    await user('StudentB', 'B', 'STUDENT');
    await prisma.groupMember.create({ data: { groupId: classA, userId: ids.StudentA } });

    const school = { targetType: 'school', targetId: schools.A };
    const toClass = { targetType: 'class', targetId: classA, groupId: classA };
    const toStaff = { targetType: 'role', targetId: roles.STAFF, roleId: roles.STAFF };
    const toParent = () => ({ targetType: 'user', targetId: ids.ParentA, userId: ids.ParentA });

    await document('SchoolWide', 'A1', { rules: [school], tags: 'math,exam' });
    await document('ClassOnly', 'A1', { rules: [toClass], tags: 'math' });
    await document('StaffOnly', 'A2', { rules: [toStaff], mimeType: 'image/png', tags: 'mathematics' });
    await document('ParentShared', 'A2', { rules: [toParent()], mimeType: 'text/plain' });
    await document('Draft', 'A1', { tags: 'exam' });
    await document('Processing', 'A1', { rules: [school], status: 'ocr' });
    await document('Failed', 'A1', { rules: [school], status: 'error' });
    // Replaced: v1 available, v2 still processing → readers keep seeing it.
    await document('Replaced', 'A2', { rules: [school], status: 'indexing', previous: 'available' });
    await document('OtherSchool', 'B', { rules: [{ targetType: 'school', targetId: schools.B }] });
    await document('Deleted', 'A1', { rules: [school] });
    await prisma.document.update({ where: { id: docs.Deleted }, data: { deletedAt: new Date() } });

    platformAdminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@school.edu` } } });
    await prisma.school.deleteMany({ where: { name: { contains: 'Test E2E DocList School' } } });
    await app.close();
  });

  describe('each role gets exactly its scope', () => {
    const inA = ['ClassOnly', 'Draft', 'Failed', 'ParentShared', 'Processing', 'Replaced', 'SchoolWide', 'StaffOnly'];

    it('platform admin: every document, any status, not the deleted one', async () => {
      expect(await seen(platformAdminId)).toEqual([...inA, 'OtherSchool'].sort());
    });

    it.each(['AdminA', 'ManagerA'])('%s: every document of the school, any status', async (key) => {
      expect(await seen(ids[key])).toEqual(inA);
    });

    it('staff: documents published to them that are available', async () => {
      expect(await seen(ids.StaffA)).toEqual(['Replaced', 'SchoolWide', 'StaffOnly']);
    });

    it('student: documents of their school or class that are available', async () => {
      expect(await seen(ids.StudentA)).toEqual(['ClassOnly', 'Replaced', 'SchoolWide']);
    });

    it('parent: the school-wide ones and what is shared with them', async () => {
      expect(await seen(ids.ParentA)).toEqual(['ParentShared', 'Replaced', 'SchoolWide']);
    });

    it('a student of another school sees only theirs', async () => {
      expect(await seen(ids.StudentB)).toEqual(['OtherSchool']);
    });

    it('readers never see a document still in processing, even when asking for its status', async () => {
      expect(await seen(ids.StudentA, { status: 'ocr' })).toEqual([]);
      expect(await seen(ids.AdminA, { status: 'ocr' })).toEqual(['Processing']);
    });

    it('returns the current version of each document', async () => {
      const res = check(await list(ids.AdminA, { q: `${tag} Replaced` }), 200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].currentVersion).toMatchObject({ versionNo: 2, status: 'indexing', mimeType: 'application/pdf' });
    });

    it('GET /documents/:id returns the current version too', async () => {
      const res = check(await http().get(`/documents/${docs.Replaced}`).set('Authorization', await bearer(ids.AdminA)), 200);
      expect(res.body.currentVersion).toMatchObject({ versionNo: 2, status: 'indexing', mimeType: 'application/pdf' });
      const draft = check(await http().get(`/documents/${docs.Draft}`).set('Authorization', await bearer(ids.AdminA)), 200);
      expect(draft.body.currentVersion).toMatchObject({ versionNo: 1 });
    });
  });

  describe('filters', () => {
    it('by space', async () => {
      expect(await seen(ids.AdminA, { spaceId: spaces.A2 })).toEqual(['ParentShared', 'Replaced', 'StaffOnly']);
    });

    it('by title, ignoring case', async () => {
      expect(await seen(ids.AdminA, { q: `${tag} schoolwide`.toUpperCase() })).toEqual(['SchoolWide']);
    });

    it('by whole tags: all of them must be there', async () => {
      expect(await seen(ids.AdminA, { tags: 'math' })).toEqual(['ClassOnly', 'SchoolWide']);
      expect(await seen(ids.AdminA, { tags: ' MATH , exam ' })).toEqual(['SchoolWide']);
      expect(await seen(ids.AdminA, { tags: 'mathematics' })).toEqual(['StaffOnly']);
    });

    it('by status of the current version', async () => {
      expect(await seen(ids.AdminA, { status: 'error' })).toEqual(['Failed']);
      expect(await seen(ids.AdminA, { status: 'indexing' })).toEqual(['Replaced']);
    });

    it('by file type', async () => {
      expect(await seen(ids.AdminA, { type: 'image' })).toEqual(['StaffOnly']);
      expect(await seen(ids.AdminA, { type: 'text' })).toEqual(['ParentShared']);
    });

    it('for readers, status and type apply to the versions they may see, not to one still in processing', async () => {
      // Replaced: v1 available, v2 (current) still indexing.
      expect(await seen(ids.StudentA, { status: 'available' })).toEqual(['ClassOnly', 'Replaced', 'SchoolWide']);
      expect(await seen(ids.StudentA, { status: 'indexing' })).toEqual([]);
      expect(await seen(ids.AdminA, { status: 'available' })).not.toContain('Replaced');

      // Rescanned: v1 available PDF, v2 (current) an image still in OCR.
      await document('Rescanned', 'A1', { rules: [{ targetType: 'school', targetId: schools.A }], status: 'ocr', mimeType: 'image/png', previous: 'available' });
      try {
        expect(await seen(ids.StudentA, { type: 'pdf' })).toContain('Rescanned');
        expect(await seen(ids.StudentA, { type: 'image' })).not.toContain('Rescanned');
        expect(await seen(ids.AdminA, { type: 'image' })).toContain('Rescanned');
        expect(await seen(ids.AdminA, { type: 'pdf' })).not.toContain('Rescanned');
      } finally {
        await prisma.document.update({ where: { id: docs.Rescanned }, data: { deletedAt: new Date() } });
      }
    });

    it('repeated tags parameters add up', async () => {
      const res = check(
        await http().get('/documents').query(`q=${tag}&tags=math&tags=exam,math`).set('Authorization', await bearer(ids.AdminA)),
        200,
      );
      expect(keysOf(res.body)).toEqual(['SchoolWide']);
    });

    it('filters combine with the role scope', async () => {
      expect(await seen(ids.StudentA, { tags: 'math', spaceId: spaces.A1 })).toEqual(['ClassOnly', 'SchoolWide']);
    });

    it.each([
      ['an unknown status', { status: 'done' }],
      ['an unknown type', { type: 'video' }],
      ['an invalid space id', { spaceId: 'abc' }],
      ['an empty search', { q: '  ' }],
      ['too many tags', { tags: Array.from({ length: 11 }, (_, i) => `t${i}`).join(',') }],
      ['an unknown parameter', { sort: 'title' }],
    ])('rejects %s with 400', async (_label, query) => {
      check(await list(ids.AdminA, query), 400);
    });
  });

  describe('pagination', () => {
    it('pages through the filtered list, newest first, without overlap', async () => {
      const first = check(await list(ids.AdminA, { q: tag, limit: 3, page: 1 }), 200).body;
      const third = check(await list(ids.AdminA, { q: tag, limit: 3, page: 3 }), 200).body;
      expect(first).toMatchObject({ total: 8, page: 1, limit: 3, totalPages: 3 });
      expect(first.data).toHaveLength(3);
      expect(third.data).toHaveLength(2);
      const all = check(await list(ids.AdminA, { q: tag }), 200).body.data.map((d: { id: string }) => d.id);
      expect(first.data.map((d: { id: string }) => d.id)).toEqual(all.slice(0, 3));
      expect(third.data.map((d: { id: string }) => d.id)).toEqual(all.slice(6, 8));
    });

    it('counts only what the caller may see', async () => {
      expect(check(await list(ids.StudentA, { q: tag }), 200).body.total).toBe(3);
    });
  });

  it('requires a token', async () => {
    await http().get('/documents').expect(401);
  });
});
