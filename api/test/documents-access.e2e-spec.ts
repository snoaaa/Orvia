import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { STORAGE_SERVICE } from '../src/storage/storage.constants.js';
import type { StorageService } from '../src/storage/storage.service.js';

/**
 * POST/GET /documents/:id/access (#109): publish a document to a school, role, class, group or user,
 * and who can then open it (details, download, stream).
 */
describe('Document publication (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  let storage: StorageService;
  const stamp = Date.now();
  const tag = `P${stamp}`;
  const schools = { A: '', B: '' };
  const spaces = { A: '', B: '' };
  const ids: Record<string, string> = {};
  const roles: Record<string, string> = {};
  const groups = { classA: '', otherClassA: '', departmentA: '', classB: '' };
  const storageKeys: string[] = [];
  let platformAdminId: string;

  const http = () => request(app.getHttpServer());
  const bearer = async (id: string) => `Bearer ${(await tokens.issueAccessToken(id)).accessToken}`;
  const publish = async (as: string, documentId: string, rules: unknown) =>
    http()
      .post(`/documents/${documentId}/access`)
      .set('Authorization', await bearer(as))
      .send({ rules });
  const rules = async (as: string, documentId: string) =>
    http()
      .get(`/documents/${documentId}/access`)
      .set('Authorization', await bearer(as));
  const details = async (as: string, documentId: string) =>
    http()
      .get(`/documents/${documentId}`)
      .set('Authorization', await bearer(as));
  const download = async (as: string, documentId: string, route = 'download') =>
    http()
      .get(`/documents/${documentId}/${route}`)
      .set('Authorization', await bearer(as));
  /** Asserts the HTTP status (with the body in the failure message) and returns the response. */
  const check = <T extends { status: number; body: unknown }>(res: T, status: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    return res;
  };
  /** Expects `key` to open the document (details and download) or not, with 403. */
  const canOpen = async (key: string, documentId: string, allowed: boolean) => {
    check(await details(ids[key], documentId), allowed ? 200 : 403);
    check(await download(ids[key], documentId), allowed ? 200 : 403);
  };

  /** A document of `school` with one stored version. */
  async function document(school: keyof typeof schools, title: string) {
    const doc = await prisma.document.create({ data: { spaceId: spaces[school], title: `${tag} ${title}` } });
    const storageKey = `e2e-109/${stamp}/${doc.id}.txt`;
    await storage.save(storageKey, `content of ${title}`);
    storageKeys.push(storageKey);
    // A processed version: readers only see available documents (#111).
    const version = await prisma.documentVersion.create({
      data: { documentId: doc.id, storageKey, mimeType: 'text/plain', checksum: `sha-${doc.id}`, status: 'available' },
    });
    await prisma.document.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
    return doc.id;
  }

  async function user(key: string, school: keyof typeof schools, roleName: string, groupId?: string) {
    const created = await prisma.user.create({
      data: { email: `e2e-docaccess-${key.toLowerCase()}-${stamp}@school.edu`, fullName: `${key} Name`, status: 'ACTIVE' },
    });
    await prisma.userAssignment.create({
      data: { userId: created.id, schoolId: schools[school], roleId: roles[roleName], groupId },
    });
    ids[key] = created.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    storage = app.get(STORAGE_SERVICE);

    for (const role of await prisma.role.findMany()) roles[role.name] = role.id;
    for (const key of ['A', 'B'] as const) {
      schools[key] = (await prisma.school.create({ data: { name: `Test E2E DocAccess School ${key} ${stamp}` } })).id;
      spaces[key] = (await prisma.space.create({ data: { schoolId: schools[key], name: `${tag} space ${key}` } })).id;
    }
    const group = async (school: keyof typeof schools, name: string, type: string) =>
      (await prisma.group.create({ data: { schoolId: schools[school], name: `${tag} ${name}`, type } })).id;
    groups.classA = await group('A', '6e A', 'class');
    groups.otherClassA = await group('A', '6e B', 'class');
    groups.departmentA = await group('A', 'Sciences', 'department');
    groups.classB = await group('B', '6e A', 'class');

    await user('AdminA', 'A', 'SCHOOL_ADMIN');
    await user('ManagerA', 'A', 'CONTENT_MANAGER');
    await user('StaffA', 'A', 'STAFF');
    await user('StudentA', 'A', 'STUDENT'); // member of 6e A through group_members
    await user('AssignedStudentA', 'A', 'STUDENT', groups.classA); // in 6e A through its assignment
    await user('OtherStudentA', 'A', 'STUDENT'); // member of 6e B
    await user('ParentA', 'A', 'PARENT_GUEST');
    await user('AdminB', 'B', 'SCHOOL_ADMIN');
    await user('StudentB', 'B', 'STUDENT');
    await prisma.groupMember.createMany({
      data: [
        { groupId: groups.classA, userId: ids.StudentA },
        { groupId: groups.otherClassA, userId: ids.OtherStudentA },
        { groupId: groups.departmentA, userId: ids.StaffA },
      ],
    });

    platformAdminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@school.edu` } } });
    await prisma.school.deleteMany({ where: { name: { contains: 'Test E2E DocAccess School' } } });
    for (const key of storageKeys) await storage.delete(key).catch(() => undefined);
    await app.close();
  });

  describe('who can publish', () => {
    let doc: string;
    beforeAll(async () => {
      doc = await document('A', 'Who can publish');
    });

    it('requires a token', async () => {
      await http().get(`/documents/${doc}/access`).expect(401);
      await http().post(`/documents/${doc}/access`).send({ rules: [{ type: 'school', id: schools.A }] }).expect(401);
    });

    it.each(['StaffA', 'StudentA', 'ParentA'])('rejects %s (no documents:manage)', async (key) => {
      check(await publish(ids[key], doc, [{ type: 'school', id: schools.A }]), 403);
      check(await rules(ids[key], doc), 403);
    });

    it('a school admin of another school cannot publish or list the rules', async () => {
      check(await publish(ids.AdminB, doc, [{ type: 'school', id: schools.A }]), 403);
      check(await rules(ids.AdminB, doc), 403);
    });

    it('a content manager and a school admin of the school can, and so can a platform admin', async () => {
      check(await publish(ids.ManagerA, doc, [{ type: 'class', id: groups.classA }]), 201);
      check(await publish(ids.AdminA, doc, [{ type: 'role', id: roles.STAFF }]), 201);
      check(await publish(platformAdminId, doc, [{ type: 'user', id: ids.ParentA }]), 201);
      expect(check(await rules(ids.ManagerA, doc), 200).body).toHaveLength(3);
    });

    it('answers 404 for an unknown or deleted document and 400 for an invalid id', async () => {
      check(await publish(ids.AdminA, '00000000-0000-4000-8000-000000000000', [{ type: 'school', id: schools.A }]), 404);
      const deleted = await document('A', 'Deleted');
      await prisma.document.update({ where: { id: deleted }, data: { deletedAt: new Date() } });
      check(await publish(ids.AdminA, deleted, [{ type: 'school', id: schools.A }]), 404);
      check(await rules(ids.AdminA, 'abc'), 400);
      // Every document route checks the id the same way.
      const auth = { Authorization: await bearer(ids.AdminA) };
      for (const path of ['abc', 'abc/versions', 'abc/download', 'abc/stream', 'abc/versions/1/download']) {
        check(await http().get(`/documents/${path}`).set(auth), 400);
      }
      check(await http().patch('/documents/abc').set(auth).send({ title: 'x' }), 400);
      check(await http().delete('/documents/abc').set(auth), 400);
    });
  });

  describe('validation', () => {
    let doc: string;
    beforeAll(async () => {
      doc = await document('A', 'Validation');
    });

    it.each([
      ['no rules', []],
      ['not an array', { type: 'school' }],
      ['an unknown type', [{ type: 'everyone', id: '00000000-0000-4000-8000-000000000000' }]],
      ['an invalid id', [{ type: 'school', id: 'abc' }]],
      ['an extra field', [{ type: 'school', id: '00000000-0000-4000-8000-000000000000', extra: 1 }]],
    ])('rejects %s', async (_label, body) => {
      check(await publish(ids.AdminA, doc, body), 400);
    });

    it('rejects more than 50 rules', async () => {
      check(await publish(ids.AdminA, doc, Array.from({ length: 51 }, () => ({ type: 'school', id: schools.A }))), 400);
    });

    it('rejects targets outside the document school, and writes nothing', async () => {
      const outside = [
        { type: 'school', id: schools.B },
        { type: 'class', id: groups.classB },
        { type: 'user', id: ids.StudentB },
        { type: 'role', id: roles.PLATFORM_ADMIN },
        { type: 'role', id: '00000000-0000-4000-8000-000000000000' },
        { type: 'class', id: groups.departmentA },
      ];
      for (const rule of outside) {
        check(await publish(ids.AdminA, doc, [{ type: 'school', id: schools.A }, rule]), 400);
      }
      expect(await prisma.documentAccess.count({ where: { documentId: doc } })).toBe(0);
    });
  });

  describe('publishing', () => {
    it('lists the rules with readable names, and skips targets the document already has', async () => {
      const doc = await document('A', 'Names');
      const first = check(
        await publish(ids.AdminA, doc, [
          { type: 'school', id: schools.A },
          { type: 'group', id: groups.classA },
          { type: 'group', id: groups.departmentA },
          { type: 'role', id: roles.STAFF },
          { type: 'user', id: ids.ParentA },
        ]),
        201,
      );
      // Rules added together share their creation time, so their order among themselves is not part of the contract.
      expect(first.body.map((r: { type: string; targetName: string }) => [r.type, r.targetName])).toEqual(
        expect.arrayContaining([
          ['school', `Test E2E DocAccess School A ${stamp}`],
          ['class', `${tag} 6e A`],
          ['group', `${tag} Sciences`],
          ['role', 'STAFF'],
          ['user', 'ParentA Name'],
        ]),
      );
      expect(first.body).toHaveLength(5);
      expect(first.body.find((r: { type: string }) => r.type === 'school')).toMatchObject({ documentId: doc, targetId: schools.A });

      const again = check(await publish(ids.AdminA, doc, [{ type: 'class', id: groups.classA }]), 201);
      expect(again.body).toHaveLength(5);
      expect(check(await rules(ids.AdminA, doc), 200).body).toEqual(again.body);
    });

    it('records document_published with the targets added only', async () => {
      const doc = await document('A', 'Audit');
      check(await publish(ids.ManagerA, doc, [{ type: 'role', id: roles.STAFF }]), 201);
      check(await publish(ids.ManagerA, doc, [{ type: 'role', id: roles.STAFF }, { type: 'class', id: groups.classA }]), 201);
      const events = await prisma.auditEvent.findMany({
        where: { action: 'document_published', entityId: doc },
        orderBy: { seq: 'asc' },
      });
      expect(events.map((e) => (e.details as { rules: unknown }).rules)).toEqual([
        [{ type: 'role', targetId: roles.STAFF }],
        [{ type: 'class', targetId: groups.classA }],
      ]);
      expect(events[0]).toMatchObject({ category: 'documents', actorId: ids.ManagerA });
    });

    it('two simultaneous requests for the same target store it once', async () => {
      const doc = await document('A', 'Race');
      const results = await Promise.all([
        publish(ids.AdminA, doc, [{ type: 'class', id: groups.classA }]),
        publish(ids.ManagerA, doc, [{ type: 'class', id: groups.classA }]),
      ]);
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      expect(await prisma.documentAccess.count({ where: { documentId: doc } })).toBe(1);
    });
  });

  describe('who can open a published document', () => {
    it('a document without rules is a draft that only its managers open', async () => {
      const doc = await document('A', 'Draft');
      await canOpen('AdminA', doc, true);
      await canOpen('ManagerA', doc, true);
      for (const key of ['StaffA', 'StudentA', 'ParentA']) await canOpen(key, doc, false);
      check(await details(platformAdminId, doc), 200);
    });

    it('a document published to a class is open only to the members of that class', async () => {
      const doc = await document('A', 'Class');
      check(await publish(ids.ManagerA, doc, [{ type: 'class', id: groups.classA }]), 201);
      await canOpen('StudentA', doc, true);
      await canOpen('AssignedStudentA', doc, true);
      check(await download(ids.StudentA, doc, 'stream'), 200);
      for (const key of ['OtherStudentA', 'StaffA', 'ParentA', 'StudentB']) await canOpen(key, doc, false);
      // Managers still see it.
      await canOpen('ManagerA', doc, true);
    });

    it('a document published to a group is open to its members', async () => {
      const doc = await document('A', 'Group');
      check(await publish(ids.AdminA, doc, [{ type: 'group', id: groups.departmentA }]), 201);
      await canOpen('StaffA', doc, true);
      await canOpen('StudentA', doc, false);
    });

    it('a document published to a role is open to that role in the school', async () => {
      const doc = await document('A', 'Role');
      check(await publish(ids.AdminA, doc, [{ type: 'role', id: roles.STUDENT }]), 201);
      for (const key of ['StudentA', 'AssignedStudentA', 'OtherStudentA']) await canOpen(key, doc, true);
      await canOpen('StaffA', doc, false);
      // A student of another school holds the same role, but not in this school.
      await canOpen('StudentB', doc, false);
    });

    it('a document published to the school is open to everyone in it, not to other schools', async () => {
      const doc = await document('A', 'School');
      check(await publish(ids.AdminA, doc, [{ type: 'school', id: schools.A }]), 201);
      for (const key of ['StaffA', 'StudentA', 'ParentA']) await canOpen(key, doc, true);
      await canOpen('StudentB', doc, false);
    });

    it('a guest or parent opens a document only when it is shared with them', async () => {
      const doc = await document('A', 'Parent');
      check(await publish(ids.AdminA, doc, [{ type: 'role', id: roles.STAFF }]), 201);
      await canOpen('ParentA', doc, false);
      check(await publish(ids.AdminA, doc, [{ type: 'user', id: ids.ParentA }]), 201);
      await canOpen('ParentA', doc, true);
    });

    it('someone removed from the school loses access, even through a user rule', async () => {
      const doc = await document('A', 'Leaver');
      await user('LeaverA', 'A', 'STUDENT');
      check(await publish(ids.AdminA, doc, [{ type: 'user', id: ids.LeaverA }]), 201);
      await canOpen('LeaverA', doc, true);
      await prisma.userAssignment.updateMany({ where: { userId: ids.LeaverA }, data: { deletedAt: new Date() } });
      check(await download(ids.LeaverA, doc), 403);
    });

    it('a deleted document stays closed, whatever its rules', async () => {
      const doc = await document('A', 'Deleted after publish');
      check(await publish(ids.AdminA, doc, [{ type: 'school', id: schools.A }]), 201);
      await prisma.document.update({ where: { id: doc }, data: { deletedAt: new Date() } });
      check(await details(ids.StudentA, doc), 404);
      check(await download(ids.StudentA, doc), 404);
    });
  });
});
