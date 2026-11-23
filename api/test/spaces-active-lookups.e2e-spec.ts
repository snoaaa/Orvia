import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { ProcessingQueueService } from '../src/documents/services/processing-queue.service.js';
import { STORAGE_SERVICE } from '../src/storage/storage.constants.js';

/**
 * Every lookup of a space filtered by `deletedAt` (#98), through a real request on an ACTIVE space.
 * These lookups used `findUnique({ where: { id, ...ACTIVE_SPACE } })` and now use `findFirst`, because
 * `deletedAt` is not part of a unique key. The deleted-space side (404) is covered in spaces-delete.e2e-spec.ts.
 *
 *   GET    /documents/spaces/:id                 findSpaceById
 *   PATCH  /documents/spaces/:id                 updateSpace (lookup, then re-read after the update)
 *   DELETE /documents/spaces/:id                 deleteSpace
 *   POST   /documents                            createDocument
 *   POST   /documents/spaces/:id/validate-file   validateUploadedFile + FileValidationService duplicate check
 *   POST   /documents/spaces/:id/upload          uploadPdf
 *   POST   /documents/spaces/:id/upload-image    uploadImage
 *
 * Storage is replaced by an in-memory stub and the background processing queue by a no-op, so no file is
 * written to disk and nothing runs after the test.
 */
describe('Lookups of an active space (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const stamp = Date.now();
  let schoolId = '';
  let managerId = '';
  let counter = 0;
  const files = new Map<string, Buffer>();

  const http = () => request(app.getHttpServer());
  const bearer = async () => `Bearer ${(await tokens.issueAccessToken(managerId)).accessToken}`;
  /** Asserts the HTTP status (with the body in the failure message) and returns the response. */
  const check = <T extends { status: number; body: unknown }>(res: T, status: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    return res;
  };
  const newSpace = (name = `Active ${stamp}-${++counter}`) => prisma.space.create({ data: { schoolId, name } });

  /** A different, valid file on each call: the duplicate check compares checksums inside a space. */
  const pdf = () =>
    Buffer.from(
      `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n` +
        `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n% ${stamp}-${++counter}\n` +
        `trailer<</Root 1 0 R>>\n%%EOF\n`,
    );
  /** A valid 1x1 PNG, with unique trailing bytes so the duplicate check never matches. */
  const png = () => {
    const base = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    return Buffer.concat([base, Buffer.from(`${stamp}-${++counter}`)]);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(STORAGE_SERVICE)
      .useValue({
        save: async (key: string, data: Buffer) => void files.set(key, Buffer.from(data)),
        exists: async (key: string) => files.has(key),
        delete: async (key: string) => void files.delete(key),
        getMetadata: async (key: string) => ({ size: files.get(key)?.length ?? 0 }),
        read: async () => {
          throw new Error('not used in this spec');
        },
      })
      .overrideProvider(ProcessingQueueService)
      .useValue({ enqueueJob: () => undefined })
      .compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    schoolId = (await prisma.school.create({ data: { name: `Test E2E ActiveLookup School ${stamp}` } })).id;
    const manager = await prisma.user.create({
      data: { email: `e2e-actlookup-${stamp}@school.edu`, fullName: 'Manager', status: 'ACTIVE' },
    });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CONTENT_MANAGER' } });
    await prisma.userAssignment.create({ data: { userId: manager.id, schoolId, roleId: role.id } });
    managerId = manager.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
    // Deleting the school cascades to its spaces, documents and versions.
    await prisma.school.deleteMany({ where: { name: { contains: 'Test E2E ActiveLookup School' } } });
    await app.close();
  });

  it('GET /documents/spaces/:id returns an active space', async () => {
    const target = await newSpace();
    const res = check(await http().get(`/documents/spaces/${target.id}`).set('Authorization', await bearer()), 200);
    expect(res.body).toMatchObject({ id: target.id, name: target.name });
  });

  it('PATCH /documents/spaces/:id updates an active space and returns the new values', async () => {
    const target = await newSpace();
    const res = check(
      await http()
        .patch(`/documents/spaces/${target.id}`)
        .set('Authorization', await bearer())
        .send({ name: `Renamed ${stamp}-${++counter}`, language: 'fr' }),
      200,
    );
    expect(res.body).toMatchObject({ id: target.id, language: 'fr' });
    expect((await prisma.space.findUniqueOrThrow({ where: { id: target.id } })).name).toBe(res.body.name);
  });

  it('DELETE /documents/spaces/:id deletes an active space', async () => {
    const target = await newSpace();
    check(await http().delete(`/documents/spaces/${target.id}`).set('Authorization', await bearer()), 204);
    expect((await prisma.space.findUniqueOrThrow({ where: { id: target.id } })).deletedAt).not.toBeNull();
  });

  it('POST /documents registers a document in an active space', async () => {
    const target = await newSpace();
    const res = check(
      await http()
        .post('/documents')
        .set('Authorization', await bearer())
        .send({ spaceId: target.id, title: `Doc ${stamp}-${++counter}`, url: 'e2e/doc.pdf' }),
      201,
    );
    expect(res.body).toMatchObject({ spaceId: target.id });
  });

  it('POST /documents/spaces/:id/validate-file validates a file for an active space', async () => {
    const target = await newSpace();
    check(
      await http()
        .post(`/documents/spaces/${target.id}/validate-file`)
        .set('Authorization', await bearer())
        .attach('file', pdf(), 'a.pdf'),
      201,
    );
  });

  it('POST /documents/spaces/:id/upload stores a PDF in an active space', async () => {
    const target = await newSpace();
    const res = check(
      await http()
        .post(`/documents/spaces/${target.id}/upload`)
        .set('Authorization', await bearer())
        .attach('file', pdf(), 'a.pdf'),
      201,
    );
    expect(res.body).toMatchObject({ spaceId: target.id });
  });

  it('POST /documents/spaces/:id/upload-image stores an image in an active space', async () => {
    const target = await newSpace();
    const res = check(
      await http()
        .post(`/documents/spaces/${target.id}/upload-image`)
        .set('Authorization', await bearer())
        .attach('file', png(), 'a.png'),
      201,
    );
    expect(res.body).toMatchObject({ spaceId: target.id });
  });
});
