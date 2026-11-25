import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/**
 * GET /conversations, GET /conversations/:id, GET /conversations/:id/messages (#123):
 * - User isolation: every user (even platform/school admins) reads only their own conversations.
 * - Another user's or soft-deleted conversation returns 404.
 * - List is newest first and paginated; detail returns chronological messages and citations.
 */
describe('Conversations read (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const stamp = Date.now();

  let schoolId = '';
  let spaceAId = '';
  let spaceBId = '';
  let docActiveId = '';
  let docActiveVerId = '';
  let docDeletedId = '';
  let docDeletedVerId = '';

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
        email: `e2e-conv-${key.toLowerCase()}-${stamp}@school.edu`,
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

    const school = await prisma.school.create({ data: { name: `E2E Conv School ${stamp}` } });
    schoolId = school.id;

    spaceAId = (await prisma.space.create({ data: { schoolId, name: `Space A ${stamp}` } })).id;
    spaceBId = (await prisma.space.create({ data: { schoolId, name: `Space B ${stamp}` } })).id;

    const docActive = await prisma.document.create({
      data: { spaceId: spaceAId, title: `Physics Guide ${stamp}` },
    });
    docActiveId = docActive.id;
    const verActive = await prisma.documentVersion.create({
      data: {
        documentId: docActiveId,
        versionNo: 2,
        storageKey: `e2e/conv-active-${stamp}.pdf`,
        mimeType: 'application/pdf',
        checksum: `chk-a-${stamp}`,
        status: 'available',
      },
    });
    docActiveVerId = verActive.id;

    const docDeleted = await prisma.document.create({
      data: { spaceId: spaceAId, title: `Archived Guide ${stamp}`, deletedAt: new Date() },
    });
    docDeletedId = docDeleted.id;
    const verDeleted = await prisma.documentVersion.create({
      data: {
        documentId: docDeletedId,
        versionNo: 1,
        storageKey: `e2e/conv-deleted-${stamp}.pdf`,
        mimeType: 'application/pdf',
        checksum: `chk-d-${stamp}`,
        status: 'available',
      },
    });
    docDeletedVerId = verDeleted.id;

    const pa = await prisma.user.findFirstOrThrow({ where: { assignments: { some: { role: { name: 'PLATFORM_ADMIN' }, deletedAt: null } } } });
    platformAdminId = pa.id;

    await createUser('StudentA', 'STUDENT');
    await createUser('StaffA', 'STAFF');
    await createUser('SchoolAdminA', 'SCHOOL_ADMIN');
    await createUser('SuspendedStudent', 'STUDENT', { status: 'SUSPENDED' });

    // Role without conversations:read
    const noConvRole = await prisma.role.create({ data: { name: `E2E_NO_CONV_${stamp}`, scope: 'school' } });
    roles.NO_CONV = noConvRole.id;
    await createUser('NoPermUser', 'NO_CONV');
  });

  afterAll(async () => {
    await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
    await prisma.document.deleteMany({ where: { id: { in: [docActiveId, docDeletedId] } } });
    await prisma.space.deleteMany({ where: { id: { in: [spaceAId, spaceBId] } } });
    const userIds = Object.values(users);
    if (userIds.length > 0) {
      await prisma.userAssignment.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (roles.NO_CONV) {
      await prisma.role.deleteMany({ where: { id: roles.NO_CONV } });
    }
    if (schoolId) {
      await prisma.school.deleteMany({ where: { id: schoolId } });
    }
    await app.close();
  });

  describe('access control', () => {
    it('rejects unauthenticated requests with 401', async () => {
      check(await http().get('/conversations'), 401);
      check(await http().get('/conversations/00000000-0000-4000-8000-000000000000'), 401);
      check(await http().get('/conversations/00000000-0000-4000-8000-000000000000/messages'), 401);
    });

    it('rejects users without conversations:read or suspended users with 403', async () => {
      check(await http().get('/conversations').set('Authorization', await bearer(users.NoPermUser)), 403);
      check(await http().get('/conversations').set('Authorization', await bearer(users.SuspendedStudent)), 403);
    });
  });

  describe('list, pagination, isolation, and detail with citations', () => {
    let convOldId = '';
    let convNewId = '';
    let convOtherSpaceId = '';
    let convDeletedId = '';
    let staffConvId = '';

    beforeAll(async () => {
      const cOld = await prisma.conversation.create({
        data: {
          userId: users.StudentA,
          spaceId: spaceAId,
          title: 'Old Newton Laws',
          createdAt: new Date('2026-11-10T10:00:00Z'),
          updatedAt: new Date('2026-11-10T10:00:00Z'),
        },
      });
      convOldId = cOld.id;

      const cOtherSpace = await prisma.conversation.create({
        data: {
          userId: users.StudentA,
          spaceId: spaceBId,
          title: 'Chemistry Basics',
          createdAt: new Date('2026-11-15T10:00:00Z'),
          updatedAt: new Date('2026-11-15T10:00:00Z'),
        },
      });
      convOtherSpaceId = cOtherSpace.id;

      const cNew = await prisma.conversation.create({
        data: {
          userId: users.StudentA,
          spaceId: spaceAId,
          title: 'Quantum Mechanics Intro',
          createdAt: new Date('2026-11-20T10:00:00Z'),
          updatedAt: new Date('2026-11-20T12:00:00Z'),
        },
      });
      convNewId = cNew.id;

      const cDeleted = await prisma.conversation.create({
        data: {
          userId: users.StudentA,
          spaceId: spaceAId,
          title: 'Deleted Conversation',
          deletedAt: new Date('2026-11-20T13:00:00Z'),
        },
      });
      convDeletedId = cDeleted.id;

      const cStaff = await prisma.conversation.create({
        data: {
          userId: users.StaffA,
          spaceId: spaceAId,
          title: 'Staff Private Conversation',
        },
      });
      staffConvId = cStaff.id;

      createdConversationIds.push(convOldId, convOtherSpaceId, convNewId, convDeletedId, staffConvId);

      // Messages in convNewId (including one soft-deleted message that must not appear)
      await prisma.message.create({
        data: {
          conversationId: convNewId,
          role: 'user',
          content: 'Explain wave-particle duality.',
          status: 'completed',
          createdAt: new Date('2026-11-20T10:00:00Z'),
        },
      });
      await prisma.message.create({
        data: {
          conversationId: convNewId,
          role: 'assistant',
          content: 'Light exhibits both wave and particle properties [1][2].',
          modelUsed: 'mock-rag-v1',
          parameters: { temperature: 0.2 },
          status: 'completed',
          createdAt: new Date('2026-11-20T10:00:05Z'),
          references: {
            create: [
              {
                marker: 1,
                documentVersionId: docActiveVerId,
                pageOrImageId: 'page_12',
                excerpt: 'Wave-particle duality is central to quantum mechanics.',
                coordinates: '{"x":0.1,"y":0.2,"width":0.6,"height":0.15}',
                createdAt: new Date('2026-11-20T10:00:05.000Z'),
              },
              {
                marker: 2,
                documentVersionId: docDeletedVerId,
                pageOrImageId: 'page_3',
                excerpt: 'Previously archived explanation.',
                coordinates: null,
                createdAt: new Date('2026-11-20T10:00:06.000Z'),
              },
            ],
          },
        },
      });
      await prisma.message.create({
        data: {
          conversationId: convNewId,
          role: 'user',
          content: 'Removed message',
          deletedAt: new Date('2026-11-20T10:01:00Z'),
          createdAt: new Date('2026-11-20T10:00:10Z'),
        },
      });
    });

    it('lists only caller conversations, newest first, excluding deleted ones, and paginates', async () => {
      const p1 = check(
        await http().get('/conversations?page=1&limit=2').set('Authorization', await bearer(users.StudentA)),
        200,
      );
      expect(p1.body.total).toBe(3);
      expect(p1.body.page).toBe(1);
      expect(p1.body.limit).toBe(2);
      expect(p1.body.totalPages).toBe(2);
      expect((p1.body.data as { id: string }[]).map((c) => c.id)).toEqual([convNewId, convOtherSpaceId]);
      expect(p1.body.data[0]).toMatchObject({
        id: convNewId,
        title: 'Quantum Mechanics Intro',
        messageCount: 2,
      });

      const p2 = check(
        await http().get('/conversations?page=2&limit=2').set('Authorization', await bearer(users.StudentA)),
        200,
      );
      expect((p2.body.data as { id: string }[]).map((c) => c.id)).toEqual([convOldId]);
    });

    it('supports spaceId and trimmed q filters', async () => {
      const bySpace = check(
        await http().get(`/conversations?spaceId=${spaceBId}`).set('Authorization', await bearer(users.StudentA)),
        200,
      );
      expect((bySpace.body.data as { id: string }[]).map((c) => c.id)).toEqual([convOtherSpaceId]);

      const bySearch = check(
        await http().get('/conversations?q=%20%20Quantum%20%20').set('Authorization', await bearer(users.StudentA)),
        200,
      );
      expect((bySearch.body.data as { id: string }[]).map((c) => c.id)).toEqual([convNewId]);
    });

    it('enforces user isolation even for SchoolAdmin and PlatformAdmin in list', async () => {
      const staffRes = check(
        await http().get('/conversations').set('Authorization', await bearer(users.StaffA)),
        200,
      );
      expect((staffRes.body.data as { id: string }[]).map((c) => c.id)).toEqual([staffConvId]);

      const schoolAdminRes = check(
        await http().get('/conversations').set('Authorization', await bearer(users.SchoolAdminA)),
        200,
      );
      expect(schoolAdminRes.body.data).toEqual([]);
    });

    it('rejects invalid query params with 400', async () => {
      check(await http().get('/conversations?page=0').set('Authorization', await bearer(users.StudentA)), 400);
      check(await http().get('/conversations?limit=101').set('Authorization', await bearer(users.StudentA)), 400);
      check(await http().get('/conversations?spaceId=bad-uuid').set('Authorization', await bearer(users.StudentA)), 400);
      check(await http().get('/conversations?unknown=1').set('Authorization', await bearer(users.StudentA)), 400);
    });

    it('returns 400 for invalid UUID and 404 for unknown, deleted, or another user’s conversation', async () => {
      check(await http().get('/conversations/not-a-uuid').set('Authorization', await bearer(users.StudentA)), 400);
      check(
        await http().get('/conversations/00000000-0000-4000-8000-000000000000').set('Authorization', await bearer(users.StudentA)),
        404,
      );
      check(await http().get(`/conversations/${convDeletedId}`).set('Authorization', await bearer(users.StudentA)), 404);
      // Another user's conversation (checked by Student, SchoolAdmin, and PlatformAdmin)
      check(await http().get(`/conversations/${staffConvId}`).set('Authorization', await bearer(users.StudentA)), 404);
      check(await http().get(`/conversations/${staffConvId}`).set('Authorization', await bearer(users.SchoolAdminA)), 404);
      check(await http().get(`/conversations/${staffConvId}`).set('Authorization', await bearer(platformAdminId)), 404);
      check(await http().get(`/conversations/${staffConvId}/messages`).set('Authorization', await bearer(users.StudentA)), 404);
    });

    it('returns conversation detail with chronological messages and citations (including unavailable flag)', async () => {
      const res = check(
        await http().get(`/conversations/${convNewId}`).set('Authorization', await bearer(users.StudentA)),
        200,
      );
      expect(res.body).toMatchObject({
        id: convNewId,
        userId: users.StudentA,
        spaceId: spaceAId,
        title: 'Quantum Mechanics Intro',
      });
      expect(res.body.messages).toHaveLength(2);
      expect(res.body.messages[0]).toMatchObject({
        role: 'user',
        content: 'Explain wave-particle duality.',
      });
      // #119: the stored 'completed' is given as 'done', with the evidence flag.
      expect(res.body.messages[1]).toMatchObject({
        role: 'assistant',
        modelUsed: 'mock-rag-v1',
        status: 'done',
        notEnoughEvidence: false,
      });
      expect(res.body.messages[1].citations).toHaveLength(2);
      expect(res.body.messages[1].citations[0]).toMatchObject({
        documentId: docActiveId,
        versionId: docActiveVerId,
        documentName: `Physics Guide ${stamp}`,
        versionNumber: 2,
        pageOrImageId: 'page_12',
        excerpt: 'Wave-particle duality is central to quantum mechanics.',
        marker: 1,
        zone: { x: 0.1, y: 0.2, width: 0.6, height: 0.15 },
        available: true,
      });
      expect(res.body.messages[1].citations[0]).not.toHaveProperty('coordinates');
      expect(res.body.messages[1].citations[1]).toMatchObject({
        documentId: docDeletedId,
        versionId: docDeletedVerId,
        marker: 2,
        zone: null,
        available: false,
      });

      // Also verify GET /conversations/:id/messages returns the same messages
      const msgsRes = check(
        await http().get(`/conversations/${convNewId}/messages`).set('Authorization', await bearer(users.StudentA)),
        200,
      );
      expect(msgsRes.body).toHaveLength(2);
      expect(msgsRes.body[1].citations).toHaveLength(2);
    });
  });
});
