import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { ACTIVE_DOCUMENT, ACTIVE_SPACE } from '../src/documents/utils/active-space.util.js';

/** DELETE /documents/spaces/:id (#98): who can do it where, soft delete, hidden space and documents, audit. */
describe('Delete a space (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const stamp = Date.now();
  const schools = { A: '', B: '' };
  const ids: Record<string, string> = {};
  let platformAdminId: string;
  let counter = 0;

  const http = () => request(app.getHttpServer());
  const bearer = async (id: string) => `Bearer ${(await tokens.issueAccessToken(id)).accessToken}`;
  const remove = async (as: string, id: string) =>
    http().delete(`/documents/spaces/${id}`).set('Authorization', await bearer(as));
  const get = async (as: string, path: string) => http().get(path).set('Authorization', await bearer(as));
  /** Asserts the HTTP status (with the body in the failure message) and returns the response. */
  const check = <T extends { status: number; body: unknown }>(res: T, status: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    return res;
  };
  const uniqueName = (label: string) => `${label} ${stamp}-${++counter}`;
  const space = async (school: keyof typeof schools, name = uniqueName('Space')) =>
    prisma.space.create({ data: { schoolId: schools[school], name } });
  /** A document with one version, inserted directly (no file in storage: the routes under test stop before it). */
  const document = async (spaceId: string, title = uniqueName('Doc')) =>
    prisma.document.create({
      data: {
        spaceId,
        title,
        versions: { create: { versionNo: 1, storageKey: `e2e/${stamp}/${++counter}.pdf`, mimeType: 'application/pdf', checksum: `sum-${stamp}-${counter}` } },
      },
    });
  const stored = async (id: string) => prisma.space.findUniqueOrThrow({ where: { id } });
  const auditOf = async (spaceId: string) =>
    prisma.auditEvent.findMany({ where: { action: 'space_deleted', entityType: 'space', entityId: spaceId } });

  type Assignment = { school: keyof typeof schools; role: string };
  async function user(key: string, assignments: Assignment[]) {
    const created = await prisma.user.create({
      data: { email: `e2e-spdel-${key.toLowerCase()}-${stamp}@school.edu`, fullName: key, status: 'ACTIVE' },
    });
    for (const a of assignments) {
      const role = await prisma.role.findUniqueOrThrow({ where: { name: a.role } });
      await prisma.userAssignment.create({ data: { userId: created.id, schoolId: schools[a.school], roleId: role.id } });
    }
    ids[key] = created.id;
    return created.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    schools.A = (await prisma.school.create({ data: { name: `Test E2E SpDel School A ${stamp}` } })).id;
    schools.B = (await prisma.school.create({ data: { name: `Test E2E SpDel School B ${stamp}` } })).id;

    await user('AdminA', [{ school: 'A', role: 'SCHOOL_ADMIN' }]);
    await user('ManagerA', [{ school: 'A', role: 'CONTENT_MANAGER' }]);
    await user('ManagerAStaffB', [
      { school: 'A', role: 'CONTENT_MANAGER' },
      { school: 'B', role: 'STAFF' },
    ]);
    await user('StaffA', [{ school: 'A', role: 'STAFF' }]);
    await user('StudentA', [{ school: 'A', role: 'STUDENT' }]);
    await user('GuestA', [{ school: 'A', role: 'PARENT_GUEST' }]);

    platformAdminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
    // Deleting the schools cascades to their spaces, documents and versions.
    await prisma.school.deleteMany({ where: { name: { contains: 'Test E2E SpDel School' } } });
    await app.close();
  });

  describe('access', () => {
    it('requires a token', async () => {
      const target = await space('A');
      await http().delete(`/documents/spaces/${target.id}`).expect(401);
      expect((await stored(target.id)).deletedAt).toBeNull();
    });

    it.each(['StaffA', 'StudentA', 'GuestA'])('rejects %s (no space rights) and leaves the space untouched', async (key) => {
      const target = await space('A');
      check(await remove(ids[key], target.id), 403);
      expect((await stored(target.id)).deletedAt).toBeNull();
      expect(await auditOf(target.id)).toHaveLength(0);
    });

    it('a platform admin deletes a space of any school', async () => {
      const target = await space('B');
      await remove(platformAdminId, target.id).then((res) => check(res, 204));
      expect((await stored(target.id)).deletedAt).toBeInstanceOf(Date);
    });

    it.each(['AdminA', 'ManagerA'])('%s deletes a space of their school', async (key) => {
      const target = await space('A');
      check(await remove(ids[key], target.id), 204);
      expect((await stored(target.id)).deletedAt).toBeInstanceOf(Date);
    });

    it.each(['AdminA', 'ManagerA'])('%s cannot delete a space of another school', async (key) => {
      const target = await space('B');
      check(await remove(ids[key], target.id), 403);
      expect((await stored(target.id)).deletedAt).toBeNull();
    });

    it('document-management rights only count in the school where they are held', async () => {
      const inA = await space('A');
      const inB = await space('B');
      check(await remove(ids.ManagerAStaffB, inA.id), 204);
      check(await remove(ids.ManagerAStaffB, inB.id), 403);
      expect((await stored(inB.id)).deletedAt).toBeNull();
    });
  });

  describe('validation', () => {
    it('returns 400 for an invalid UUID', async () => {
      check(await remove(ids.AdminA, 'not-a-uuid'), 400);
    });

    it('returns 404 for an unknown space', async () => {
      check(await remove(platformAdminId, '00000000-0000-4000-8000-000000000000'), 404);
    });

    it('returns 404 for an already deleted space, and records the deletion once', async () => {
      const target = await space('A');
      check(await remove(ids.AdminA, target.id), 204);
      check(await remove(ids.AdminA, target.id), 404);
      check(await remove(platformAdminId, target.id), 404);
      expect(await auditOf(target.id)).toHaveLength(1);
    });
  });

  describe('soft delete', () => {
    it('keeps the row in the database, with deleted_at set and the name made free', async () => {
      const name = uniqueName('Kept');
      const target = await space('A', name);
      check(await remove(ids.AdminA, target.id), 204);

      const row = await stored(target.id);
      expect(row.deletedAt).toBeInstanceOf(Date);
      expect(row.schoolId).toBe(schools.A);
      expect(row.name).not.toBe(name);
      expect(row.name.startsWith(`${name} [deleted `)).toBe(true);
      expect(row.name.length).toBeLessThanOrEqual(191);
    });

    it('lets the school create a new space with the same name', async () => {
      const name = uniqueName('Reused');
      const target = await space('A', name);
      check(await remove(ids.AdminA, target.id), 204);

      const created = await http()
        .post('/documents/spaces')
        .set('Authorization', await bearer(ids.AdminA))
        .send({ schoolId: schools.A, name });
      check(created, 201);
      expect(created.body.id).not.toBe(target.id);
    });

    it('does not touch the documents of the space: they are hidden through the space', async () => {
      const target = await space('A');
      const doc = await document(target.id);
      check(await remove(ids.AdminA, target.id), 204);

      const row = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
      expect(row.deletedAt).toBeNull();
      expect(await prisma.documentVersion.count({ where: { documentId: doc.id } })).toBe(1);
    });

    it('writes one space_deleted audit event with the original name and the number of documents', async () => {
      const name = uniqueName('Audited');
      const target = await space('A', name);
      await document(target.id);
      await document(target.id);
      const gone = await document(target.id);
      await prisma.document.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
      check(await remove(ids.ManagerA, target.id), 204);

      const events = await auditOf(target.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ category: 'documents', actorId: ids.ManagerA, actorRole: 'CONTENT_MANAGER' });
      expect(events[0].details).toMatchObject({ schoolId: schools.A, name, documentsCount: 2 });
    });
  });

  describe('a deleted space no longer appears for anyone', () => {
    let live: { id: string; name: string };
    let dead: { id: string; name: string };
    let liveDoc: { id: string; title: string };
    let deadDoc: { id: string; title: string };

    beforeAll(async () => {
      live = await space('A', uniqueName('Live'));
      dead = await space('A', uniqueName('Dead'));
      liveDoc = await document(live.id, uniqueName('Live doc'));
      deadDoc = await document(dead.id, uniqueName('Dead doc'));
      await prisma.documentVersion.updateMany({
        where: { documentId: { in: [liveDoc.id, deadDoc.id] } },
        data: { status: 'available' },
      });
      await prisma.documentAccess.createMany({
        data: [liveDoc.id, deadDoc.id].map((documentId) => ({
          documentId,
          schoolId: schools.A,
          targetType: 'school',
          targetId: schools.A,
        })),
      });
      check(await remove(ids.AdminA, dead.id), 204);
    });

    it.each(['platform', 'AdminA', 'ManagerA', 'StaffA', 'StudentA'])('the space list of %s leaves it out', async (key) => {
      const as = key === 'platform' ? platformAdminId : ids[key];
      // StaffA and StudentA may or may not hold spaces:read; when they do, the deleted space must be absent.
      const res = await get(as, '/documents/spaces?limit=100');
      if (res.status === 200) {
        const listed = (res.body.data as { id: string }[]).map((s) => s.id);
        expect(listed).not.toContain(dead.id);
        if (key !== 'StudentA') expect(listed).toContain(live.id);
      } else {
        expect(res.status).toBe(403);
      }
    });

    it('GET and PATCH on the space return 404', async () => {
      check(await get(ids.AdminA, `/documents/spaces/${dead.id}`), 404);
      check(await get(platformAdminId, `/documents/spaces/${dead.id}`), 404);
      const patch = await http()
        .patch(`/documents/spaces/${dead.id}`)
        .set('Authorization', await bearer(ids.AdminA))
        .send({ name: uniqueName('Revived') });
      check(patch, 404);
      expect((await stored(dead.id)).deletedAt).toBeInstanceOf(Date);
    });

    it('PATCH on a deleted space returns 404 and leaves its "[deleted ...]" name unchanged (#98)', async () => {
      const before = await stored(dead.id);
      expect(before.name).toContain('[deleted');
      for (const as of [ids.AdminA, platformAdminId]) {
        const res = await http()
          .patch(`/documents/spaces/${dead.id}`)
          .set('Authorization', await bearer(as))
          .send({ name: dead.name, privacy: 'private' });
        check(res, 404);
      }
      const after = await stored(dead.id);
      expect(after.name).toBe(before.name);
      expect(after.privacy).toBe(before.privacy);
      expect(after.deletedAt).toEqual(before.deletedAt);
    });

    it('its documents leave the document list, while the documents of other spaces stay', async () => {
      const res = check(await get(ids.AdminA, '/documents?limit=100'), 200);
      const listed = (res.body.data as { id: string }[]).map((d) => d.id);
      expect(listed).not.toContain(deadDoc.id);
      expect(listed).toContain(liveDoc.id);

      const platform = check(await get(platformAdminId, '/documents?limit=100'), 200);
      expect((platform.body.data as { id: string }[]).map((d) => d.id)).not.toContain(deadDoc.id);
    });

    it('its documents return 404 on get, versions, download and stream', async () => {
      check(await get(ids.AdminA, `/documents/${liveDoc.id}`), 200);

      for (const as of [ids.AdminA, ids.ManagerA, platformAdminId]) {
        check(await get(as, `/documents/${deadDoc.id}`), 404);
        check(await get(as, `/documents/${deadDoc.id}/versions`), 404);
        check(await get(as, `/documents/${deadDoc.id}/download`), 404);
        check(await get(as, `/documents/${deadDoc.id}/stream`), 404);
        check(await get(as, `/documents/${deadDoc.id}/versions/1/download`), 404);
        check(await get(as, `/documents/${deadDoc.id}/versions/1/stream`), 404);
      }
    });

    it('its documents cannot be edited, deleted or replaced', async () => {
      const auth = await bearer(ids.AdminA);
      check(await http().patch(`/documents/${deadDoc.id}`).set('Authorization', auth).send({ title: 'x' }), 404);
      check(await http().delete(`/documents/${deadDoc.id}`).set('Authorization', auth), 404);
      check(
        await http().post(`/documents/${deadDoc.id}/replace`).set('Authorization', auth).attach('file', Buffer.from('%PDF-1.4'), 'a.pdf'),
        404,
      );
      expect((await prisma.document.findUniqueOrThrow({ where: { id: deadDoc.id } })).deletedAt).toBeNull();
    });

    it('nothing can be uploaded, validated or registered in it', async () => {
      const auth = await bearer(ids.AdminA);
      const pdf = Buffer.from('%PDF-1.4\n%%EOF');
      check(await http().post(`/documents/spaces/${dead.id}/validate-file`).set('Authorization', auth).attach('file', pdf, 'a.pdf'), 404);
      check(await http().post(`/documents/spaces/${dead.id}/upload`).set('Authorization', auth).attach('file', pdf, 'a.pdf'), 404);
      check(await http().post(`/documents/spaces/${dead.id}/upload-image`).set('Authorization', auth).attach('file', pdf, 'a.png'), 404);
      check(await http().post('/documents').set('Authorization', auth).send({ spaceId: dead.id, title: 'x', url: 'x' }), 404);
      expect(await prisma.document.count({ where: { spaceId: dead.id } })).toBe(1);
    });

    it('the retrieval filter ACTIVE_DOCUMENT never returns its documents or versions', async () => {
      // The shape future RAG retrieval must use (see README): the filter hides the space's documents,
      // versions, and anything reached through them, while the rows are still in the database.
      expect(await prisma.document.count({ where: { id: deadDoc.id } })).toBe(1);

      expect(await prisma.document.findMany({ where: { ...ACTIVE_DOCUMENT, spaceId: dead.id } })).toHaveLength(0);
      expect(await prisma.document.findMany({ where: { ...ACTIVE_DOCUMENT, id: liveDoc.id } })).toHaveLength(1);
      expect(await prisma.documentVersion.findMany({ where: { document: { ...ACTIVE_DOCUMENT, spaceId: dead.id } } })).toHaveLength(0);
      expect(await prisma.documentVersion.findMany({ where: { document: { ...ACTIVE_DOCUMENT, id: liveDoc.id } } })).toHaveLength(1);
      expect(await prisma.space.findMany({ where: { ...ACTIVE_SPACE, id: dead.id } })).toHaveLength(0);
    });

    it('the overview counts neither the space nor its documents', async () => {
      const before = check(await get(ids.AdminA, '/admin/overview'), 200).body.documents;
      const target = await space('A', uniqueName('Counted'));
      await document(target.id);
      await document(target.id);
      const during = check(await get(ids.AdminA, '/admin/overview'), 200).body.documents;
      expect(during.spaces).toBe(before.spaces + 1);
      expect(during.total).toBe(before.total + 2);

      check(await remove(ids.AdminA, target.id), 204);
      const after = check(await get(ids.AdminA, '/admin/overview'), 200).body;
      expect(after.documents.spaces).toBe(before.spaces);
      expect(after.documents.total).toBe(before.total);
      expect((after.spaces as { id: string }[]).map((s) => s.id)).not.toContain(target.id);
    });

    it('never leaves an active document in a deleted space under concurrent DELETE and POST /documents', async () => {
      const target = await space('A', uniqueName('RaceDoc'));
      const auth = await bearer(ids.AdminA);

      const [delRes, postRes] = await Promise.all([
        http().delete(`/documents/spaces/${target.id}`).set('Authorization', auth),
        http().post('/documents').set('Authorization', auth).send({ spaceId: target.id, title: 'RaceDoc', url: 'e2e/race.pdf' }),
      ]);

      expect(delRes.status).toBe(204);
      expect([201, 404]).toContain(postRes.status);
      const docCount = await prisma.document.count({ where: { spaceId: target.id, deletedAt: null } });
      const ev = await prisma.auditEvent.findFirstOrThrow({ where: { action: 'space_deleted', entityId: target.id } });
      expect((ev.details as { documentsCount: number }).documentsCount).toBe(docCount);
      if (postRes.status === 201) {
        check(await get(ids.AdminA, `/documents/${postRes.body.id}`), 404);
      }
    });

    it('rejects deleting a space of a deactivated school with 400 and stamps target schoolId on audit', async () => {
      const off = await prisma.school.create({
        data: { name: `Test E2E Spaces School Off ${stamp}`, status: 'deactivated' },
      });
      const frozen = await prisma.space.create({ data: { schoolId: off.id, name: uniqueName('FrozenDel') } });
      check(await remove(platformAdminId, frozen.id), 400);

      const live = await space('A', uniqueName('PlatformDel'));
      check(await remove(platformAdminId, live.id), 204);
      const ev = await prisma.auditEvent.findFirstOrThrow({ where: { action: 'space_deleted', entityId: live.id } });
      expect(ev.schoolId).toBe(schools.A);
    });
  });
});
