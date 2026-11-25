import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { STORAGE_SERVICE } from '../src/storage/storage.constants.js';
import type { StorageService } from '../src/storage/storage.service.js';

/**
 * Regression (#116): GET /documents/:id/versions returned 500 because the uploader
 * lookup selected a non-existent `name` column on User (the model has `fullName`).
 */
describe('Document version history (e2e) (#116)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  let storage: StorageService;

  const stamp = Date.now();
  let schoolId = '';
  let spaceId = '';
  let managerId = '';
  const storageKeys: string[] = [];

  const http = () => request(app.getHttpServer());
  const bearer = async (id: string) =>
    `Bearer ${(await tokens.issueAccessToken(id)).accessToken}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    storage = app.get(STORAGE_SERVICE);

    const managerRole = await prisma.role.findFirstOrThrow({
      where: { name: 'CONTENT_MANAGER' },
    });
    const school = await prisma.school.create({
      data: { name: `Test E2E Versions School ${stamp}` },
    });
    schoolId = school.id;
    const space = await prisma.space.create({
      data: { schoolId, name: `Versions Space ${stamp}` },
    });
    spaceId = space.id;
    const manager = await prisma.user.create({
      data: {
        email: `e2e-versions-mgr-${stamp}@school.edu`,
        fullName: 'Version Uploader',
        status: 'ACTIVE',
      },
    });
    managerId = manager.id;
    await prisma.userAssignment.create({
      data: { userId: managerId, schoolId, roleId: managerRole.id },
    });
  });

  afterAll(async () => {
    for (const key of storageKeys) {
      await storage.delete(key).catch(() => undefined);
    }
    await prisma.user.deleteMany({
      where: { email: { contains: `-${stamp}@school.edu` } },
    });
    await prisma.school.deleteMany({
      where: { name: { contains: 'Test E2E Versions School' } },
    });
    await app.close();
  });

  it('lists versions with the uploader fullName after an upload', async () => {
    const token = await bearer(managerId);

    const upload = await http()
      .post(`/documents/spaces/${spaceId}/upload`)
      .set('Authorization', token)
      .field('title', `Versions Doc ${stamp}`)
      .attach(
        'file',
        Buffer.from(`# Versions ${stamp}\n\nBody.`),
        'versions.md',
      );
    expect(upload.status).toBe(201);
    if (upload.body.currentVersion?.storageKey) {
      storageKeys.push(upload.body.currentVersion.storageKey);
    }

    const res = await http()
      .get(`/documents/${upload.body.id}/versions`)
      .set('Authorization', token);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      versionNo: 1,
      isCurrent: true,
      statusError: null,
      uploader: { id: managerId, name: 'Version Uploader' },
    });
  });

  it('serializes concurrent replace requests into distinct versions (no P2034)', async () => {
    const token = await bearer(managerId);
    const upload = await http()
      .post(`/documents/spaces/${spaceId}/upload`)
      .set('Authorization', token)
      .field('title', `Concurrent Replace ${stamp}`)
      .attach('file', Buffer.from(`# v1 ${stamp}`), 'conc-v1.md');
    expect(upload.status).toBe(201);
    const docId = upload.body.id as string;
    if (upload.body.currentVersion?.storageKey) {
      storageKeys.push(upload.body.currentVersion.storageKey);
    }

    const [r1, r2] = await Promise.all([
      http()
        .post(`/documents/${docId}/replace`)
        .set('Authorization', token)
        .attach('file', Buffer.from(`# v2a ${stamp}`), 'conc-v2a.md'),
      http()
        .post(`/documents/${docId}/replace`)
        .set('Authorization', token)
        .attach('file', Buffer.from(`# v2b ${stamp}`), 'conc-v2b.md'),
    ]);
    expect([r1.status, r2.status]).toEqual([201, 201]);

    const versionsRes = await http()
      .get(`/documents/${docId}/versions`)
      .set('Authorization', token);
    expect(versionsRes.status).toBe(200);
    expect(versionsRes.body).toHaveLength(3);
    for (const v of versionsRes.body as Array<{ storageKey: string }>) {
      storageKeys.push(v.storageKey);
    }
    const numbers = (versionsRes.body as Array<{ versionNumber: number }>).map(
      (v) => v.versionNumber,
    );
    expect(numbers).toEqual([3, 2, 1]);
  });
});
