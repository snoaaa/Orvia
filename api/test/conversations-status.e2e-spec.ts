import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/**
 * GET /conversations/:id/messages/:messageId/status (#122):
 * - Auth, permissions, suspended users, UUID validation.
 * - Client can poll pending -> generating -> done (receives answer + citations) and failed (with errorCode).
 * - Strict user isolation: another user (even PlatformAdmin) cannot poll someone else's message -> 404.
 * - Soft-deleted message or soft-deleted conversation -> 404.
 */
describe('Message generation status polling (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const stamp = Date.now();

  let schoolId = '';
  let spaceId = '';
  let docId = '';
  let docVerId = '';
  const roles: Record<string, string> = {};
  const users: Record<string, string> = {};
  const createdConversationIds: string[] = [];
  let platformAdminId = '';

  const http = () => request(app.getHttpServer());
  const bearer = async (id: string) => `Bearer ${(await tokens.issueAccessToken(id)).accessToken}`;
  const check = <T extends { status: number; body: unknown }>(res: T, status: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    return res;
  };

  async function createUser(key: string, roleName: string, opts: { status?: 'ACTIVE' | 'SUSPENDED' } = {}) {
    const created = await prisma.user.create({
      data: {
        email: `e2e-conv-stat-${key.toLowerCase()}-${stamp}@school.edu`,
        fullName: key,
        status: opts.status ?? 'ACTIVE',
      },
    });
    await prisma.userAssignment.create({
      data: { userId: created.id, schoolId, roleId: roles[roleName] },
    });
    users[key] = created.id;
    return created.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    for (const r of await prisma.role.findMany()) roles[r.name] = r.id;

    const school = await prisma.school.create({ data: { name: `E2E Conv Status School ${stamp}` } });
    schoolId = school.id;
    spaceId = (await prisma.space.create({ data: { schoolId, name: `Space ${stamp}` } })).id;

    const doc = await prisma.document.create({ data: { spaceId, title: `Biology Notes ${stamp}` } });
    docId = doc.id;
    const ver = await prisma.documentVersion.create({
      data: {
        documentId: docId,
        versionNo: 1,
        storageKey: `e2e/stat-${stamp}.pdf`,
        mimeType: 'application/pdf',
        checksum: `chk-stat-${stamp}`,
        status: 'available',
      },
    });
    docVerId = ver.id;

    const pa = await prisma.user.findFirstOrThrow({
      where: { assignments: { some: { role: { name: 'PLATFORM_ADMIN' }, deletedAt: null } } },
    });
    platformAdminId = pa.id;

    await createUser('StudentA', 'STUDENT');
    await createUser('StaffA', 'STAFF');
    await createUser('SuspendedA', 'STUDENT', { status: 'SUSPENDED' });
  });

  afterAll(async () => {
    await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
    await prisma.document.deleteMany({ where: { id: docId } });
    await prisma.space.deleteMany({ where: { id: spaceId } });
    const userIds = Object.values(users);
    if (userIds.length > 0) {
      await prisma.userAssignment.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (schoolId) {
      await prisma.school.deleteMany({ where: { id: schoolId } });
    }
    await app.close();
  });

  it('rejects unauthenticated (401), suspended (403), and invalid UUIDs (400)', async () => {
    const valid = '00000000-0000-4000-8000-000000000000';
    check(await http().get(`/conversations/${valid}/messages/${valid}/status`), 401);
    check(
      await http().get(`/conversations/${valid}/messages/${valid}/status`).set('Authorization', await bearer(users.SuspendedA)),
      403,
    );
    check(
      await http().get(`/conversations/bad-uuid/messages/${valid}/status`).set('Authorization', await bearer(users.StudentA)),
      400,
    );
    check(
      await http().get(`/conversations/${valid}/messages/bad-uuid/status`).set('Authorization', await bearer(users.StudentA)),
      400,
    );
  });

  it('allows owner to poll pending -> generating -> done (with answer & citations) and failed (with errorCode)', async () => {
    const conv = await prisma.conversation.create({
      data: { userId: users.StudentA, spaceId, title: 'Polling Test' },
    });
    createdConversationIds.push(conv.id);

    const msg = await prisma.message.create({
      data: {
        conversationId: conv.id,
        role: 'assistant',
        content: '',
        modelUsed: 'mock-rag-v1',
        status: 'pending',
      },
    });

    // 1. pending
    const r1 = check(
      await http()
        .get(`/conversations/${conv.id}/messages/${msg.id}/status`)
        .set('Authorization', await bearer(users.StudentA)),
      200,
    );
    expect(r1.body).toMatchObject({
      messageId: msg.id,
      conversationId: conv.id,
      status: 'pending',
      ready: false,
      errorCode: null,
      answer: null,
    });

    // 2. generating
    await prisma.message.update({ where: { id: msg.id }, data: { status: 'generating' } });
    const r2 = check(
      await http()
        .get(`/conversations/${conv.id}/messages/${msg.id}/status`)
        .set('Authorization', await bearer(users.StudentA)),
      200,
    );
    expect(r2.body).toMatchObject({ status: 'generating', ready: false, answer: null });

    // 3. done with citations
    await prisma.message.update({
      where: { id: msg.id },
      data: {
        status: 'done',
        content: 'Mitochondria generate ATP [1].',
        references: {
          create: {
            documentVersionId: docVerId,
            pageOrImageId: 'page_2',
            excerpt: 'Mitochondria are the powerhouse of the cell.',
          },
        },
      },
    });
    const r3 = check(
      await http()
        .get(`/conversations/${conv.id}/messages/${msg.id}/status`)
        .set('Authorization', await bearer(users.StudentA)),
      200,
    );
    expect(r3.body).toMatchObject({
      status: 'done',
      ready: true,
      errorCode: null,
      answer: {
        id: msg.id,
        content: 'Mitochondria generate ATP [1].',
      },
    });
    expect(r3.body.answer.citations).toHaveLength(1);
    expect(r3.body.answer.citations[0]).toMatchObject({
      documentId: docId,
      versionId: docVerId,
      available: true,
    });

    // 4. failed message exposes errorCode and null answer
    const failedMsg = await prisma.message.create({
      data: {
        conversationId: conv.id,
        role: 'assistant',
        content: '',
        modelUsed: 'mock-rag-v1',
        status: 'failed',
        ragMetric: {
          create: {
            modelUsed: 'mock-rag-v1',
            latencyTotalMs: 500,
            status: 'error',
            errorCode: 'LLM_UNAVAILABLE',
          },
        },
      },
    });
    const r4 = check(
      await http()
        .get(`/conversations/${conv.id}/messages/${failedMsg.id}/status`)
        .set('Authorization', await bearer(users.StudentA)),
      200,
    );
    expect(r4.body).toMatchObject({
      status: 'failed',
      ready: false,
      errorCode: 'LLM_UNAVAILABLE',
      answer: null,
    });
  });

  it('prevents polling another user’s message or soft-deleted conversation/message (returns 404)', async () => {
    const conv = await prisma.conversation.create({
      data: { userId: users.StudentA, spaceId, title: 'Private Poll' },
    });
    createdConversationIds.push(conv.id);
    const msg = await prisma.message.create({
      data: { conversationId: conv.id, role: 'assistant', content: 'Secret', status: 'done' },
    });

    // Another user and PlatformAdmin cannot poll
    check(
      await http().get(`/conversations/${conv.id}/messages/${msg.id}/status`).set('Authorization', await bearer(users.StaffA)),
      404,
    );
    check(
      await http().get(`/conversations/${conv.id}/messages/${msg.id}/status`).set('Authorization', await bearer(platformAdminId)),
      404,
    );

    // Soft-deleted message -> 404
    await prisma.message.update({ where: { id: msg.id }, data: { deletedAt: new Date() } });
    check(
      await http().get(`/conversations/${conv.id}/messages/${msg.id}/status`).set('Authorization', await bearer(users.StudentA)),
      404,
    );
  });
});
