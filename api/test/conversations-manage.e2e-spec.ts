import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/**
 * PATCH /conversations/:id and DELETE /conversations/:id (#124):
 * - Auth, permissions (conversations:update / conversations:delete), suspended users.
 * - Validation (UUID, trimmed title, 1..191 chars, forbidNonWhitelisted).
 * - Ownership isolation (even PlatformAdmin cannot rename/delete someone else's conversation -> 404).
 * - Soft delete removes conversation from list/detail while preserving row with deletedAt.
 */
describe('Conversations rename and delete (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const stamp = Date.now();

  let schoolId = '';
  let spaceId = '';
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
        email: `e2e-conv-mng-${key.toLowerCase()}-${stamp}@school.edu`,
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

    const school = await prisma.school.create({ data: { name: `E2E Conv Manage School ${stamp}` } });
    schoolId = school.id;
    spaceId = (await prisma.space.create({ data: { schoolId, name: `Space ${stamp}` } })).id;

    const pa = await prisma.user.findFirstOrThrow({
      where: { assignments: { some: { role: { name: 'PLATFORM_ADMIN' }, deletedAt: null } } },
    });
    platformAdminId = pa.id;

    await createUser('StudentA', 'STUDENT');
    await createUser('StaffA', 'STAFF');
    await createUser('GuestA', 'PARENT_GUEST'); // has conversations:read, lacks conversations:update & conversations:delete
    await createUser('SuspendedA', 'STUDENT', { status: 'SUSPENDED' });
  });

  afterAll(async () => {
    await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
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

  async function makeConv(userId: string, title: string): Promise<string> {
    const conv = await prisma.conversation.create({ data: { userId, spaceId, title } });
    createdConversationIds.push(conv.id);
    return conv.id;
  }

  describe('access control', () => {
    it('rejects unauthenticated requests with 401', async () => {
      check(await http().patch('/conversations/00000000-0000-4000-8000-000000000000').send({ title: 'X' }), 401);
      check(await http().delete('/conversations/00000000-0000-4000-8000-000000000000'), 401);
    });

    it('rejects users without update/delete permissions or suspended users with 403', async () => {
      const convId = await makeConv(users.GuestA, 'Guest Chat');
      check(
        await http().patch(`/conversations/${convId}`).set('Authorization', await bearer(users.GuestA)).send({ title: 'New' }),
        403,
      );
      check(await http().delete(`/conversations/${convId}`).set('Authorization', await bearer(users.GuestA)), 403);
      check(
        await http().patch(`/conversations/${convId}`).set('Authorization', await bearer(users.SuspendedA)).send({ title: 'New' }),
        403,
      );
      check(await http().delete(`/conversations/${convId}`).set('Authorization', await bearer(users.SuspendedA)), 403);
    });
  });

  describe('rename (PATCH /conversations/:id)', () => {
    it('renames an owned conversation, trims title, and reflects in list and detail', async () => {
      const convId = await makeConv(users.StudentA, 'Original Title');
      const res = check(
        await http()
          .patch(`/conversations/${convId}`)
          .set('Authorization', await bearer(users.StudentA))
          .send({ title: '  Updated Physics Notes  ' }),
        200,
      );
      expect(res.body).toMatchObject({ id: convId, title: 'Updated Physics Notes' });

      const detail = check(
        await http().get(`/conversations/${convId}`).set('Authorization', await bearer(users.StudentA)),
        200,
      );
      expect(detail.body.title).toBe('Updated Physics Notes');
    });

    it('validates UUID, title bounds, and unknown fields with 400', async () => {
      const convId = await makeConv(users.StudentA, 'Valid');
      check(
        await http().patch('/conversations/not-a-uuid').set('Authorization', await bearer(users.StudentA)).send({ title: 'X' }),
        400,
      );
      check(
        await http().patch(`/conversations/${convId}`).set('Authorization', await bearer(users.StudentA)).send({ title: '   ' }),
        400,
      );
      check(
        await http()
          .patch(`/conversations/${convId}`)
          .set('Authorization', await bearer(users.StudentA))
          .send({ title: 'a'.repeat(192) }),
        400,
      );
      check(
        await http()
          .patch(`/conversations/${convId}`)
          .set('Authorization', await bearer(users.StudentA))
          .send({ title: 'Ok', extra: true }),
        400,
      );
    });

    it('returns 404 when another user (including platform admin) attempts to rename, leaving title intact', async () => {
      const convId = await makeConv(users.StudentA, 'Protected Title');
      check(
        await http().patch(`/conversations/${convId}`).set('Authorization', await bearer(users.StaffA)).send({ title: 'Hijack' }),
        404,
      );
      check(
        await http()
          .patch(`/conversations/${convId}`)
          .set('Authorization', await bearer(platformAdminId))
          .send({ title: 'Admin Hijack' }),
        404,
      );

      const stored = await prisma.conversation.findUniqueOrThrow({ where: { id: convId } });
      expect(stored.title).toBe('Protected Title');
    });
  });

  describe('soft delete (DELETE /conversations/:id)', () => {
    it('returns 400 for invalid UUID and 404 for unknown or another user’s conversation', async () => {
      const convId = await makeConv(users.StudentA, 'Keep Me');
      check(await http().delete('/conversations/bad-uuid').set('Authorization', await bearer(users.StudentA)), 400);
      check(
        await http().delete('/conversations/00000000-0000-4000-8000-000000000000').set('Authorization', await bearer(users.StudentA)),
        404,
      );
      check(await http().delete(`/conversations/${convId}`).set('Authorization', await bearer(users.StaffA)), 404);
      check(await http().delete(`/conversations/${convId}`).set('Authorization', await bearer(platformAdminId)), 404);

      const stored = await prisma.conversation.findUniqueOrThrow({ where: { id: convId } });
      expect(stored.deletedAt).toBeNull();
    });

    it('soft-deletes an owned conversation so it disappears from list/detail and cannot be renamed or deleted again', async () => {
      const convId = await makeConv(users.StudentA, 'To Delete');
      check(await http().delete(`/conversations/${convId}`).set('Authorization', await bearer(users.StudentA)), 204);

      const stored = await prisma.conversation.findUniqueOrThrow({ where: { id: convId } });
      expect(stored.deletedAt).toBeInstanceOf(Date);

      // Disappears from list & detail
      const list = check(await http().get('/conversations?limit=100').set('Authorization', await bearer(users.StudentA)), 200);
      expect((list.body.data as { id: string }[]).map((c) => c.id)).not.toContain(convId);
      check(await http().get(`/conversations/${convId}`).set('Authorization', await bearer(users.StudentA)), 404);

      // Repeated delete and rename return 404
      check(await http().delete(`/conversations/${convId}`).set('Authorization', await bearer(users.StudentA)), 404);
      check(
        await http().patch(`/conversations/${convId}`).set('Authorization', await bearer(users.StudentA)).send({ title: 'Zombie' }),
        404,
      );
    });
  });
});
