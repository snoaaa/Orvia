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
 * PUT /documents/:id/access and DELETE /documents/:id/access/:ruleId (#110): the change applies at once,
 * the mobile app is told who lost or gained the document, and the lost document leaves their offline data.
 */
describe('Document access change (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  let storage: StorageService;
  const stamp = Date.now();
  const tag = `C${stamp}`;
  const schools = { A: '', B: '' };
  let spaceA = '';
  const ids: Record<string, string> = {};
  const devices: Record<string, string> = {};
  const roles: Record<string, string> = {};
  let classA = '';
  const storageKeys: string[] = [];
  let platformAdminId: string;

  const http = () => request(app.getHttpServer());
  const bearer = async (id: string) => `Bearer ${(await tokens.issueAccessToken(id)).accessToken}`;
  const publish = async (as: string, doc: string, rules: unknown) =>
    http().post(`/documents/${doc}/access`).set('Authorization', await bearer(as)).send({ rules });
  const replace = async (as: string, doc: string, rules: unknown) =>
    http().put(`/documents/${doc}/access`).set('Authorization', await bearer(as)).send({ rules });
  const remove = async (as: string, doc: string, ruleId: string) =>
    http().delete(`/documents/${doc}/access/${ruleId}`).set('Authorization', await bearer(as));
  const download = async (as: string, doc: string) =>
    http().get(`/documents/${doc}/download`).set('Authorization', await bearer(as));
  const details = async (as: string, doc: string) =>
    http().get(`/documents/${doc}`).set('Authorization', await bearer(as));
  /** Asserts the HTTP status (with the body in the failure message) and returns the response. */
  const check = <T extends { status: number; body: unknown }>(res: T, status: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    return res;
  };
  /** Sync changes written for `doc`, as sorted "user key:operation" strings. */
  const syncOf = async (doc: string) => {
    const keyOf = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
    const rows = await prisma.syncChange.findMany({ where: { entityType: 'document', entityId: doc } });
    return rows.map((r) => `${keyOf[r.userId] ?? r.userId}:${r.operation}`).sort();
  };
  const clearSync = (doc: string) => prisma.syncChange.deleteMany({ where: { entityId: doc } });
  const select = (key: string, doc: string) =>
    prisma.offlineSelection.create({ data: { deviceId: devices[key], documentId: doc } });
  const selected = async (key: string, doc: string) =>
    (await prisma.offlineSelection.count({ where: { deviceId: devices[key], documentId: doc } })) > 0;

  async function document(title: string) {
    const doc = await prisma.document.create({ data: { spaceId: spaceA, title: `${tag} ${title}` } });
    const storageKey = `e2e-110/${stamp}/${doc.id}.txt`;
    await storage.save(storageKey, `content of ${title}`);
    storageKeys.push(storageKey);
    await prisma.documentVersion.create({
      data: { documentId: doc.id, storageKey, mimeType: 'text/plain', checksum: `sha-${doc.id}` },
    });
    return doc.id;
  }

  async function user(key: string, school: keyof typeof schools, roleName: string) {
    const created = await prisma.user.create({
      data: { email: `e2e-docchange-${key.toLowerCase()}-${stamp}@school.edu`, fullName: `${key} Name`, status: 'ACTIVE' },
    });
    await prisma.userAssignment.create({ data: { userId: created.id, schoolId: schools[school], roleId: roles[roleName] } });
    ids[key] = created.id;
    devices[key] = (await prisma.device.create({ data: { userId: created.id, platform: 'android' } })).id;
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
      schools[key] = (await prisma.school.create({ data: { name: `Test E2E DocChange School ${key} ${stamp}` } })).id;
    }
    spaceA = (await prisma.space.create({ data: { schoolId: schools.A, name: `${tag} space` } })).id;
    classA = (await prisma.group.create({ data: { schoolId: schools.A, name: `${tag} 6e A`, type: 'class' } })).id;

    await user('AdminA', 'A', 'SCHOOL_ADMIN');
    await user('ManagerA', 'A', 'CONTENT_MANAGER');
    await user('StaffA', 'A', 'STAFF');
    await user('StudentA', 'A', 'STUDENT'); // in 6e A
    await user('OtherStudentA', 'A', 'STUDENT');
    await user('ParentA', 'A', 'PARENT_GUEST');
    await user('AdminB', 'B', 'SCHOOL_ADMIN');
    await prisma.groupMember.create({ data: { groupId: classA, userId: ids.StudentA } });

    platformAdminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@school.edu` } } });
    await prisma.school.deleteMany({ where: { name: { contains: 'Test E2E DocChange School' } } });
    for (const key of storageKeys) await storage.delete(key).catch(() => undefined);
    await app.close();
  });

  describe('who can change the rules', () => {
    let doc: string;
    let ruleId: string;
    beforeAll(async () => {
      doc = await document('Who');
      ruleId = check(await publish(ids.AdminA, doc, [{ type: 'school', id: schools.A }]), 201).body[0].id;
    });

    it('requires a token', async () => {
      await http().put(`/documents/${doc}/access`).send({ rules: [] }).expect(401);
      await http().delete(`/documents/${doc}/access/${ruleId}`).expect(401);
    });

    it.each(['StaffA', 'StudentA', 'ParentA', 'AdminB'])('rejects %s with 403 and keeps the rule', async (key) => {
      check(await replace(ids[key], doc, []), 403);
      check(await remove(ids[key], doc, ruleId), 403);
      expect(await prisma.documentAccess.count({ where: { id: ruleId } })).toBe(1);
    });

    it('a platform admin can change any document', async () => {
      check(await replace(platformAdminId, doc, [{ type: 'school', id: schools.A }]), 200);
    });
  });

  describe('validation and not found', () => {
    let doc: string;
    let ruleId: string;
    beforeAll(async () => {
      doc = await document('Validation');
      ruleId = check(await publish(ids.AdminA, doc, [{ type: 'school', id: schools.A }]), 201).body[0].id;
    });

    it.each([
      ['a missing list', {}],
      ['an unknown type', { rules: [{ type: 'everyone', id: schools.A }] }],
      ['more than 50 rules', { rules: Array.from({ length: 51 }, () => ({ type: 'school', id: schools.A })) }],
    ])('PUT rejects %s', async (_label, body) => {
      check(await http().put(`/documents/${doc}/access`).set('Authorization', await bearer(ids.AdminA)).send(body), 400);
    });

    it('PUT with a target of another school changes nothing', async () => {
      check(await replace(ids.AdminA, doc, [{ type: 'school', id: schools.B }]), 400);
      expect(await prisma.documentAccess.findMany({ where: { documentId: doc }, select: { id: true } })).toEqual([{ id: ruleId }]);
    });

    it('DELETE answers 400 for an invalid id and 404 for a rule of another document', async () => {
      check(await remove(ids.AdminA, doc, 'abc'), 400);
      check(await remove(ids.AdminA, doc, '00000000-0000-4000-8000-000000000000'), 404);
      const other = await document('Other');
      const otherRule = check(await publish(ids.AdminA, other, [{ type: 'school', id: schools.A }]), 201).body[0].id;
      check(await remove(ids.AdminA, doc, otherRule), 404);
      expect(await prisma.documentAccess.count({ where: { id: otherRule } })).toBe(1);
    });

    it('answers 404 for a deleted document', async () => {
      await prisma.document.update({ where: { id: doc }, data: { deletedAt: new Date() } });
      check(await replace(ids.AdminA, doc, []), 404);
      check(await remove(ids.AdminA, doc, ruleId), 404);
    });
  });

  describe('removing a rule', () => {
    let doc: string;
    let classRule: string;
    beforeAll(async () => {
      doc = await document('Remove');
      const res = check(
        await publish(ids.AdminA, doc, [
          { type: 'class', id: classA },
          { type: 'user', id: ids.ParentA },
        ]),
        201,
      );
      classRule = res.body.find((r: { type: string }) => r.type === 'class').id;
      await clearSync(doc);
      await select('StudentA', doc);
      await select('ParentA', doc);
      await select('ManagerA', doc);
    });

    it('takes the document away from the readers reached only through it, at once', async () => {
      check(await download(ids.StudentA, doc), 200);
      check(await remove(ids.ManagerA, doc, classRule), 204);
      check(await details(ids.StudentA, doc), 403);
      check(await download(ids.StudentA, doc), 403);
      // The parent keeps it through their own rule; managers always see it.
      check(await download(ids.ParentA, doc), 200);
      check(await download(ids.ManagerA, doc), 200);
    });

    it('marks it for the next mobile sync and removes it from their offline selections only', async () => {
      expect(await syncOf(doc)).toEqual(['StudentA:delete']);
      expect(await selected('StudentA', doc)).toBe(false);
      expect(await selected('ParentA', doc)).toBe(true);
      expect(await selected('ManagerA', doc)).toBe(true);
    });

    it('records document_access_changed with the rule removed', async () => {
      const event = await prisma.auditEvent.findFirstOrThrow({ where: { action: 'document_access_changed', entityId: doc } });
      expect(event).toMatchObject({ category: 'documents', actorId: ids.ManagerA, schoolId: schools.A });
      expect(event.details).toMatchObject({ added: [], removed: [{ type: 'class', targetId: classA }] });
    });

    it('a second removal of the same rule answers 404', async () => {
      check(await remove(ids.ManagerA, doc, classRule), 404);
    });
  });

  describe('replacing the rules', () => {
    it('removes, adds and keeps targets; who lost and who gained it is marked', async () => {
      const doc = await document('Replace');
      check(
        await publish(ids.AdminA, doc, [
          { type: 'class', id: classA },
          { type: 'user', id: ids.ParentA },
        ]),
        201,
      );
      await clearSync(doc);

      const res = check(
        await replace(ids.AdminA, doc, [
          { type: 'user', id: ids.ParentA },
          { type: 'role', id: roles.STAFF },
        ]),
        200,
      );
      expect(res.body.map((r: { type: string }) => r.type).sort()).toEqual(['role', 'user']);
      check(await download(ids.StudentA, doc), 403);
      check(await download(ids.StaffA, doc), 200);
      check(await download(ids.ParentA, doc), 200);
      // Managers and the parent (kept rule) are not marked.
      expect(await syncOf(doc)).toEqual(['StaffA:insert', 'StudentA:delete']);

      const event = await prisma.auditEvent.findFirstOrThrow({ where: { action: 'document_access_changed', entityId: doc } });
      expect(event.details).toMatchObject({
        added: [{ type: 'role', targetId: roles.STAFF }],
        removed: [{ type: 'class', targetId: classA }],
      });
    });

    it('an empty list makes the document a draft again', async () => {
      const doc = await document('Draft again');
      check(await publish(ids.AdminA, doc, [{ type: 'school', id: schools.A }]), 201);
      await clearSync(doc);
      expect(check(await replace(ids.AdminA, doc, []), 200).body).toEqual([]);
      for (const key of ['StaffA', 'StudentA', 'OtherStudentA', 'ParentA']) check(await download(ids[key], doc), 403);
      check(await download(ids.AdminA, doc), 200);
      expect(await syncOf(doc)).toEqual(['OtherStudentA:delete', 'ParentA:delete', 'StaffA:delete', 'StudentA:delete']);
    });

    it('the same list changes nothing and records nothing', async () => {
      const doc = await document('Same');
      check(await publish(ids.AdminA, doc, [{ type: 'class', id: classA }]), 201);
      await clearSync(doc);
      check(await replace(ids.AdminA, doc, [{ type: 'group', id: classA }]), 200);
      expect(await syncOf(doc)).toEqual([]);
      expect(await prisma.auditEvent.count({ where: { action: 'document_access_changed', entityId: doc } })).toBe(0);
    });

    it('publishing also marks who gained the document (#109)', async () => {
      const doc = await document('Gain');
      check(await publish(ids.AdminA, doc, [{ type: 'class', id: classA }]), 201);
      expect(await syncOf(doc)).toEqual(['StudentA:insert']);
    });

    it('two simultaneous changes are applied one after the other', async () => {
      const doc = await document('Race');
      check(await publish(ids.AdminA, doc, [{ type: 'school', id: schools.A }]), 201);
      const lists = [[{ type: 'class', id: classA }], [{ type: 'role', id: roles.STAFF }]];
      const results = await Promise.all(lists.map((rules, i) => replace(i ? ids.ManagerA : ids.AdminA, doc, rules)));
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      const final = await prisma.documentAccess.findMany({ where: { documentId: doc } });
      expect(final).toHaveLength(1);
      expect(['class', 'role']).toContain(final[0].targetType);
    });
  });

  it('downloads may not be reused from a cache without asking again', async () => {
    const doc = await document('Cache');
    check(await publish(ids.AdminA, doc, [{ type: 'school', id: schools.A }]), 201);
    const res = check(await download(ids.StudentA, doc), 200);
    expect(res.headers['cache-control']).toBe('private, no-cache');
  });
});
