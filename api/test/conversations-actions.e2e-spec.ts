import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/**
 * Save, share (receiver-scoped citations), and report (#125):
 * - Bookmark, list (newest first, paginated), unbookmark saved answers.
 * - Share link & text; receiver only sees citations for documents they have permission to view.
 * - Report an assistant answer; school admins see only their school's reports, platform admins see all.
 */
describe('Conversations save, share, and report (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const stamp = Date.now();

  let schoolAId = '';
  let schoolBId = '';
  let spaceAId = '';
  let spaceBId = '';
  let docPublicAId = '';
  let docPublicAVerId = '';
  let docStaffOnlyAId = '';
  let docStaffOnlyAVerId = '';

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

  async function createUser(key: string, schoolId: string, roleName: string, opts: { status?: 'ACTIVE' | 'SUSPENDED' } = {}) {
    const created = await prisma.user.create({
      data: {
        email: `e2e-conv-act-${key.toLowerCase()}-${stamp}@school.edu`,
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

    schoolAId = (await prisma.school.create({ data: { name: `E2E ConvAct School A ${stamp}` } })).id;
    schoolBId = (await prisma.school.create({ data: { name: `E2E ConvAct School B ${stamp}` } })).id;
    spaceAId = (await prisma.space.create({ data: { schoolId: schoolAId, name: `Space A ${stamp}` } })).id;
    spaceBId = (await prisma.space.create({ data: { schoolId: schoolBId, name: `Space B ${stamp}` } })).id;

    // Doc 1: published to whole School A (visible to StudentA & StaffA, NOT StudentB)
    const doc1 = await prisma.document.create({ data: { spaceId: spaceAId, title: `Public School A ${stamp}` } });
    docPublicAId = doc1.id;
    const ver1 = await prisma.documentVersion.create({
      data: {
        documentId: docPublicAId,
        versionNo: 1,
        storageKey: `e2e/act-1-${stamp}.pdf`,
        mimeType: 'application/pdf',
        checksum: `chk-act-1-${stamp}`,
        status: 'available',
      },
    });
    docPublicAVerId = ver1.id;
    await prisma.documentAccess.create({
      data: { documentId: docPublicAId, schoolId: schoolAId, targetType: 'school', targetId: schoolAId },
    });

    // Doc 2: published ONLY to STAFF role in School A (visible to StaffA, NOT StudentA or StudentB)
    const doc2 = await prisma.document.create({ data: { spaceId: spaceAId, title: `Staff Confidential ${stamp}` } });
    docStaffOnlyAId = doc2.id;
    const ver2 = await prisma.documentVersion.create({
      data: {
        documentId: docStaffOnlyAId,
        versionNo: 1,
        storageKey: `e2e/act-2-${stamp}.pdf`,
        mimeType: 'application/pdf',
        checksum: `chk-act-2-${stamp}`,
        status: 'available',
      },
    });
    docStaffOnlyAVerId = ver2.id;
    await prisma.documentAccess.create({
      data: {
        documentId: docStaffOnlyAId,
        schoolId: schoolAId,
        targetType: 'role',
        targetId: roles.STAFF,
        roleId: roles.STAFF,
      },
    });

    const pa = await prisma.user.findFirstOrThrow({
      where: { assignments: { some: { role: { name: 'PLATFORM_ADMIN' }, deletedAt: null } } },
    });
    platformAdminId = pa.id;

    await createUser('StaffA', schoolAId, 'STAFF');
    await createUser('StudentA', schoolAId, 'STUDENT');
    await createUser('StudentB', schoolBId, 'STUDENT');
    await createUser('GuestA', schoolAId, 'PARENT_GUEST');
    await createUser('SchoolAdminA', schoolAId, 'SCHOOL_ADMIN');
    await createUser('SchoolAdminB', schoolBId, 'SCHOOL_ADMIN');
  });

  afterAll(async () => {
    await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
    await prisma.document.deleteMany({ where: { id: { in: [docPublicAId, docStaffOnlyAId] } } });
    await prisma.space.deleteMany({ where: { id: { in: [spaceAId, spaceBId] } } });
    const userIds = Object.values(users);
    if (userIds.length > 0) {
      await prisma.userAssignment.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.school.deleteMany({ where: { id: { in: [schoolAId, schoolBId] } } });
    await app.close();
  });

  it('saves, lists, and deletes bookmarked answers with strict ownership and idempotency', async () => {
    const conv = await prisma.conversation.create({
      data: { userId: users.StudentA, spaceId: spaceAId, title: 'Bookmark Chat' },
    });
    createdConversationIds.push(conv.id);

    const userMsg = await prisma.message.create({
      data: { conversationId: conv.id, role: 'user', content: 'Question?', status: 'done' },
    });
    const pendingMsg = await prisma.message.create({
      data: { conversationId: conv.id, role: 'assistant', content: '', status: 'pending' },
    });
    const doneMsg = await prisma.message.create({
      data: { conversationId: conv.id, role: 'assistant', content: 'Great answer!', status: 'done' },
    });

    // Permission & validation checks
    check(
      await http().post('/conversations/saved-answers').set('Authorization', await bearer(users.GuestA)).send({ messageId: doneMsg.id }),
      403,
    );
    check(
      await http().post('/conversations/saved-answers').set('Authorization', await bearer(users.StudentA)).send({ messageId: userMsg.id }),
      400,
    );
    check(
      await http().post('/conversations/saved-answers').set('Authorization', await bearer(users.StudentA)).send({ messageId: pendingMsg.id }),
      400,
    );
    check(
      await http().post('/conversations/saved-answers').set('Authorization', await bearer(users.StaffA)).send({ messageId: doneMsg.id }),
      404,
    );

    // Save twice -> idempotent
    const s1 = check(
      await http().post('/conversations/saved-answers').set('Authorization', await bearer(users.StudentA)).send({ messageId: doneMsg.id }),
      201,
    );
    const s2 = check(
      await http().post('/conversations/saved-answers').set('Authorization', await bearer(users.StudentA)).send({ messageId: doneMsg.id }),
      201,
    );
    expect(s1.body.id).toBe(s2.body.id);

    // List saved answers
    const list = check(
      await http().get('/conversations/saved-answers').set('Authorization', await bearer(users.StudentA)),
      200,
    );
    expect(list.body.total).toBe(1);
    expect(list.body.data[0]).toMatchObject({
      id: s1.body.id,
      messageId: doneMsg.id,
      conversationTitle: 'Bookmark Chat',
      message: { content: 'Great answer!' },
    });

    // StaffA cannot delete StudentA's bookmark; StudentA can
    check(
      await http().delete(`/conversations/saved-answers/${s1.body.id}`).set('Authorization', await bearer(users.StaffA)),
      404,
    );
    check(
      await http().delete(`/conversations/saved-answers/${s1.body.id}`).set('Authorization', await bearer(users.StudentA)),
      204,
    );
    const listAfter = check(
      await http().get('/conversations/saved-answers').set('Authorization', await bearer(users.StudentA)),
      200,
    );
    expect(listAfter.body.total).toBe(0);
  });

  it('shares an answer and strips citations whose source documents the receiver may not see', async () => {
    const conv = await prisma.conversation.create({
      data: { userId: users.StaffA, spaceId: spaceAId, title: 'Staff Research' },
    });
    createdConversationIds.push(conv.id);

    const msg = await prisma.message.create({
      data: {
        conversationId: conv.id,
        role: 'assistant',
        content: 'Summary combining public and staff-only docs [1][2].',
        modelUsed: 'mock-rag-v1',
        status: 'done',
        references: {
          create: [
            { marker: 1, documentVersionId: docPublicAVerId, pageOrImageId: 'page_1', excerpt: 'Public excerpt' },
            { marker: 2, documentVersionId: docStaffOnlyAVerId, pageOrImageId: 'page_4', excerpt: 'Confidential excerpt' },
          ],
        },
      },
    });

    // Only owner can generate share link
    check(
      await http().post(`/conversations/${conv.id}/messages/${msg.id}/share`).set('Authorization', await bearer(users.StudentA)),
      404,
    );
    const shared = check(
      await http().post(`/conversations/${conv.id}/messages/${msg.id}/share`).set('Authorization', await bearer(users.StaffA)),
      201,
    );
    expect(shared.body.shareToken).toBeTruthy();
    expect(shared.body.shareText).toContain('Summary combining public and staff-only docs');

    // Tampered token -> 404
    check(
      await http().get(`/conversations/shared/${shared.body.shareToken}tamper`).set('Authorization', await bearer(users.StudentA)),
      404,
    );

    // StudentA sees Doc 1 (school-wide) but NOT Doc 2 (staff-only) -> 1 citation + redactedCitationsCount: 1
    const viewStudentA = check(
      await http().get(shared.body.sharePath).set('Authorization', await bearer(users.StudentA)),
      200,
    );
    expect(viewStudentA.body.citations).toHaveLength(1);
    expect(viewStudentA.body.citations[0].documentId).toBe(docPublicAId);
    expect(viewStudentA.body.redactedCitationsCount).toBe(1);
    expect(JSON.stringify(viewStudentA.body)).not.toContain('Confidential excerpt');
    expect(JSON.stringify(viewStudentA.body)).not.toContain(docStaffOnlyAId);

    // StudentB (School B) sees neither -> 0 citations + redactedCitationsCount: 2
    const viewStudentB = check(
      await http().get(shared.body.sharePath).set('Authorization', await bearer(users.StudentB)),
      200,
    );
    expect(viewStudentB.body.citations).toEqual([]);
    expect(viewStudentB.body.redactedCitationsCount).toBe(2);

    // StaffA sees both -> 2 citations + redactedCitationsCount: 0
    const viewStaffA = check(
      await http().get(shared.body.sharePath).set('Authorization', await bearer(users.StaffA)),
      200,
    );
    expect(viewStaffA.body.citations).toHaveLength(2);
    expect(viewStaffA.body.redactedCitationsCount).toBe(0);
  });

  it('reports an answer and scopes report visibility to the right school/platform admins', async () => {
    const convA = await prisma.conversation.create({
      data: { userId: users.StudentA, spaceId: spaceAId, title: 'School A Chat' },
    });
    const convB = await prisma.conversation.create({
      data: { userId: users.StudentB, spaceId: spaceBId, title: 'School B Chat' },
    });
    createdConversationIds.push(convA.id, convB.id);

    const msgA = await prisma.message.create({
      data: { conversationId: convA.id, role: 'assistant', content: 'Hallucinated A', status: 'done' },
    });
    const msgB = await prisma.message.create({
      data: { conversationId: convB.id, role: 'assistant', content: 'Hallucinated B', status: 'done' },
    });

    // Validation & ownership
    check(
      await http()
        .post('/conversations/reports')
        .set('Authorization', await bearer(users.StudentA))
        .send({ messageId: msgA.id, reason: 'bad_reason' }),
      400,
    );
    check(
      await http()
        .post('/conversations/reports')
        .set('Authorization', await bearer(users.StaffA))
        .send({ messageId: msgA.id, reason: 'hallucination' }),
      404,
    );

    // Submit reports in School A and School B
    const repA = check(
      await http()
        .post('/conversations/reports')
        .set('Authorization', await bearer(users.StudentA))
        .send({ messageId: msgA.id, reason: 'hallucination', feedback: 'Wrong date' }),
      201,
    );
    const repB = check(
      await http()
        .post('/conversations/reports')
        .set('Authorization', await bearer(users.StudentB))
        .send({ messageId: msgB.id, reason: 'incorrect_citation' }),
      201,
    );

    // Non-admins cannot list reports
    check(await http().get('/conversations/reports').set('Authorization', await bearer(users.StudentA)), 403);
    check(await http().get('/conversations/reports').set('Authorization', await bearer(users.StaffA)), 403);

    // SchoolAdminA sees only School A's report
    const adminARes = check(
      await http().get('/conversations/reports?limit=100').set('Authorization', await bearer(users.SchoolAdminA)),
      200,
    );
    const adminAIds = (adminARes.body.data as { id: string }[]).map((r) => r.id);
    expect(adminAIds).toContain(repA.body.id);
    expect(adminAIds).not.toContain(repB.body.id);

    // SchoolAdminA filtering by School B gets empty
    const adminACross = check(
      await http().get(`/conversations/reports?schoolId=${schoolBId}`).set('Authorization', await bearer(users.SchoolAdminA)),
      200,
    );
    expect(adminACross.body.data).toEqual([]);

    // PlatformAdmin sees both School A and School B reports
    const paRes = check(
      await http().get('/conversations/reports?limit=100').set('Authorization', await bearer(platformAdminId)),
      200,
    );
    const paIds = (paRes.body.data as { id: string }[]).map((r) => r.id);
    expect(paIds).toContain(repA.body.id);
    expect(paIds).toContain(repB.body.id);
  });
});
