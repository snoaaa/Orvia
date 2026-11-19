import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { DocumentVersionStatus } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { STORAGE_SERVICE } from '../src/storage/storage.constants.js';
import type { StorageService } from '../src/storage/storage.service.js';

/**
 * Processing status (#112): GET /documents/:id/status for managers, the pipeline order enforced by the
 * dev-only simulation route (AUTH_DEV_TOOLS=true), and readers who never see processing states.
 */
describe('Document processing status (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  let storage: StorageService;
  const stamp = Date.now();
  const tag = `S${stamp}`;
  const schools = { A: '', B: '' };
  let spaceA = '';
  const ids: Record<string, string> = {};
  const roles: Record<string, string> = {};
  const storageKeys: string[] = [];

  const http = () => request(app.getHttpServer());
  const bearer = async (id: string) => `Bearer ${(await tokens.issueAccessToken(id)).accessToken}`;
  const status = async (as: string, doc: string) =>
    http().get(`/documents/${doc}/status`).set('Authorization', await bearer(as));
  const simulate = async (as: string, versionId: string, body: { status: string; reason?: string }) =>
    http().post(`/documents/dev/versions/${versionId}/status`).set('Authorization', await bearer(as)).send(body);
  const list = async (as: string) =>
    http().get('/documents').query({ q: tag, limit: 100 }).set('Authorization', await bearer(as));
  const download = async (as: string, doc: string) =>
    http().get(`/documents/${doc}/download`).set('Authorization', await bearer(as));
  /** Asserts the HTTP status (with the body in the failure message) and returns the response. */
  const check = <T extends { status: number; body: unknown }>(res: T, code: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status: code });
    return res;
  };
  const walk = async (versionId: string, steps: DocumentVersionStatus[]) => {
    for (const s of steps) check(await simulate(ids.ManagerA, versionId, { status: s }), 200);
  };

  /** Adds a version (stored file + processing job) and makes it current. */
  async function addVersion(documentId: string, versionNo: number, initial: DocumentVersionStatus = 'pending') {
    const storageKey = `e2e-112/${stamp}/${documentId}-v${versionNo}.txt`;
    await storage.save(storageKey, `content v${versionNo}`);
    storageKeys.push(storageKey);
    const version = await prisma.documentVersion.create({
      data: { documentId, versionNo, storageKey, mimeType: 'text/plain', checksum: `c${versionNo}`, status: initial },
    });
    await prisma.processingJob.create({ data: { versionId: version.id, step: 'text_chunking' } });
    await prisma.document.update({ where: { id: documentId }, data: { currentVersionId: version.id } });
    return version.id;
  }

  /** A document published to the whole school A, with a first pending version. */
  async function document(title: string) {
    const doc = await prisma.document.create({ data: { spaceId: spaceA, title: `${tag} ${title}` } });
    await prisma.documentAccess.create({
      data: { documentId: doc.id, schoolId: schools.A, targetType: 'school', targetId: schools.A },
    });
    return { id: doc.id, v1: await addVersion(doc.id, 1) };
  }

  async function user(key: string, school: keyof typeof schools, roleName: string) {
    const created = await prisma.user.create({
      data: { email: `e2e-docstatus-${key.toLowerCase()}-${stamp}@school.edu`, fullName: key, status: 'ACTIVE' },
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
    storage = app.get(STORAGE_SERVICE);

    for (const role of await prisma.role.findMany()) roles[role.name] = role.id;
    schools.A = (await prisma.school.create({ data: { name: `Test E2E DocStatus School A ${stamp}` } })).id;
    schools.B = (await prisma.school.create({ data: { name: `Test E2E DocStatus School B ${stamp}` } })).id;
    spaceA = (await prisma.space.create({ data: { schoolId: schools.A, name: `${tag} space` } })).id;

    await user('AdminA', 'A', 'SCHOOL_ADMIN');
    await user('ManagerA', 'A', 'CONTENT_MANAGER');
    await user('StudentA', 'A', 'STUDENT');
    await user('AdminB', 'B', 'SCHOOL_ADMIN');
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@school.edu` } } });
    await prisma.school.deleteMany({ where: { name: { contains: 'Test E2E DocStatus School' } } });
    for (const key of storageKeys) await storage.delete(key).catch(() => undefined);
    await app.close();
  });

  describe('GET /documents/:id/status', () => {
    it('managers of the school see it; readers and other schools do not', async () => {
      const doc = await document('Access');
      const res = check(await status(ids.AdminA, doc.id), 200);
      expect(res.body).toMatchObject({
        documentId: doc.id,
        currentVersion: { id: doc.v1, versionNo: 1, status: 'pending', statusError: null },
        steps: [expect.objectContaining({ versionId: doc.v1, step: 'text_chunking', status: 'pending' })],
      });
      check(await status(ids.StudentA, doc.id), 403);
      check(await status(ids.AdminB, doc.id), 403);
      check(await status(ids.AdminA, '00000000-0000-4000-8000-000000000000'), 404);
      check(await status(ids.AdminA, 'abc'), 400);
      await http().get(`/documents/${doc.id}/status`).expect(401);
    });
  });

  describe('moving through the pipeline', () => {
    it('shows each step while processing, then available, with the job completed', async () => {
      const doc = await document('Walk');
      for (const step of ['ocr', 'segmentation', 'indexing'] as const) {
        check(await simulate(ids.ManagerA, doc.v1, { status: step }), 200);
        const res = check(await status(ids.ManagerA, doc.id), 200).body;
        expect(res.currentVersion.status).toBe(step);
        expect(res.steps[0]).toMatchObject({ step, status: 'in_progress' });
      }
      const done = check(await simulate(ids.ManagerA, doc.v1, { status: 'available' }), 200).body;
      expect(done).toMatchObject({ from: 'indexing', status: 'available' });
      const res = check(await status(ids.ManagerA, doc.id), 200).body;
      expect(res.currentVersion.status).toBe('available');
      expect(res.steps[0]).toMatchObject({ step: 'indexing', status: 'completed', error: null });
    });

    it('refuses a step out of order (409) and an unknown status (400)', async () => {
      const doc = await document('Order');
      check(await simulate(ids.ManagerA, doc.v1, { status: 'indexing' }), 409);
      check(await simulate(ids.ManagerA, doc.v1, { status: 'available' }), 409);
      check(await simulate(ids.ManagerA, doc.v1, { status: 'done' }), 400);
      await walk(doc.v1, ['segmentation', 'indexing', 'available']);
      check(await simulate(ids.ManagerA, doc.v1, { status: 'error', reason: 'late' }), 409);
    });

    it('a failure needs a reason, which managers see; processing again clears it', async () => {
      const doc = await document('Failure');
      await walk(doc.v1, ['ocr']);
      check(await simulate(ids.ManagerA, doc.v1, { status: 'error' }), 400);
      check(await simulate(ids.ManagerA, doc.v1, { status: 'error', reason: 'Page 3 is unreadable' }), 200);

      const res = check(await status(ids.AdminA, doc.id), 200).body;
      expect(res.currentVersion).toMatchObject({ status: 'error', statusError: 'Page 3 is unreadable' });
      expect(res.steps[0]).toMatchObject({ status: 'failed', error: 'Page 3 is unreadable' });
      const listed = check(await list(ids.AdminA), 200).body.data.find((d: { id: string }) => d.id === doc.id);
      expect(listed.currentVersion).toMatchObject({ status: 'error', statusError: 'Page 3 is unreadable' });

      check(await simulate(ids.ManagerA, doc.v1, { status: 'pending' }), 200);
      expect(check(await status(ids.AdminA, doc.id), 200).body.currentVersion).toMatchObject({ status: 'pending', statusError: null });
    });

    it('only managers of the school may use the simulation route', async () => {
      const doc = await document('Dev route');
      check(await simulate(ids.StudentA, doc.v1, { status: 'ocr' }), 403);
      check(await simulate(ids.AdminB, doc.v1, { status: 'ocr' }), 403);
      check(await simulate(ids.AdminA, '00000000-0000-4000-8000-000000000000', { status: 'ocr' }), 404);
    });
  });

  describe('readers never see processing states', () => {
    it('a document appears to readers only once available, and their phones are told then', async () => {
      const doc = await document('Appears');
      // Published while still processing: no sync change yet (#110 + #112).
      expect(await prisma.syncChange.count({ where: { entityId: doc.id } })).toBe(0);
      await walk(doc.v1, ['segmentation', 'indexing']);
      expect(check(await list(ids.StudentA), 200).body.data.map((d: { id: string }) => d.id)).not.toContain(doc.id);
      check(await download(ids.StudentA, doc.id), 403);

      const done = check(await simulate(ids.ManagerA, doc.v1, { status: 'available' }), 200).body;
      expect(done.readersNotified).toBe(1);
      const listed = check(await list(ids.StudentA), 200).body.data.find((d: { id: string }) => d.id === doc.id);
      expect(listed.currentVersion).toMatchObject({ id: doc.v1, status: 'available' });
      check(await download(ids.StudentA, doc.id), 200);
      const rows = await prisma.syncChange.findMany({ where: { entityId: doc.id } });
      expect(rows.map((r) => [r.userId, r.operation])).toEqual([[ids.StudentA, 'insert']]);
    });

    it('while a replacement is processing, readers keep the available version; managers see the new one', async () => {
      const doc = await document('Replaced');
      await walk(doc.v1, ['segmentation', 'indexing', 'available']);
      const v2 = await addVersion(doc.id, 2);
      await walk(v2, ['segmentation']);

      const forStudent = check(await list(ids.StudentA), 200).body.data.find((d: { id: string }) => d.id === doc.id);
      expect(forStudent.currentVersion).toMatchObject({ id: doc.v1, versionNo: 1, status: 'available' });
      expect(forStudent.currentVersion).not.toHaveProperty('statusError');
      const forManager = check(await list(ids.ManagerA), 200).body.data.find((d: { id: string }) => d.id === doc.id);
      expect(forManager.currentVersion).toMatchObject({ id: v2, versionNo: 2, status: 'segmentation' });

      expect(check(await download(ids.StudentA, doc.id), 200).text).toBe('content v1');
      expect(check(await download(ids.ManagerA, doc.id), 200).text).toBe('content v2');

      // The second available version announces nothing: readers already had the document.
      await walk(v2, ['indexing']);
      const done = check(await simulate(ids.ManagerA, v2, { status: 'available' }), 200).body;
      expect(done.readersNotified).toBe(0);
      expect(check(await download(ids.StudentA, doc.id), 200).text).toBe('content v2');
    });
  });
});
