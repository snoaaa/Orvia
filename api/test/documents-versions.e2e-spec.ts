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
      uploader: { id: managerId, name: 'Version Uploader' },
    });
  });
});
