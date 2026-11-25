import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { setupSwagger } from '../src/config/swagger/index.js';
import { PrismaService } from '../src/database/prisma.service.js';

/**
 * The question side of the chat contract (#119): POST /conversations/:id/messages validates the question and
 * answers with the pending answer in the contract's shape. Generating and storing it is #120/#121.
 */
describe('Ask a question (e2e, #119 contract)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const stamp = Date.now();
  const ids: Record<string, string> = {};
  let schoolId = '';
  let spaceId = '';
  let conversationId = '';
  let othersConversationId = '';
  let deletedConversationId = '';

  const http = () => request(app.getHttpServer());
  const bearer = async (id: string) => `Bearer ${(await tokens.issueAccessToken(id)).accessToken}`;
  const ask = async (as: string, conversation: string, body: unknown) =>
    http().post(`/conversations/${conversation}/messages`).set('Authorization', await bearer(as)).send(body as object);
  const check = <T extends { status: number; body: unknown }>(res: T, status: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    return res;
  };

  async function user(key: string, roleName: string) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    const created = await prisma.user.create({
      data: { email: `e2e-ask-${key.toLowerCase()}-${stamp}@school.edu`, fullName: key, status: 'ACTIVE' },
    });
    await prisma.userAssignment.create({ data: { userId: created.id, schoolId, roleId: role.id } });
    ids[key] = created.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    setupSwagger(app, { enabled: true, protected: false, path: 'api/docs' });
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    schoolId = (await prisma.school.create({ data: { name: `Test E2E Ask School ${stamp}` } })).id;
    spaceId = (await prisma.space.create({ data: { schoolId, name: `Ask space ${stamp}` } })).id;
    await user('Student', 'STUDENT');
    await user('OtherStudent', 'STUDENT');

    const conversation = (title: string, userId: string, deletedAt: Date | null = null) =>
      prisma.conversation.create({ data: { userId, spaceId, title: `${title} ${stamp}`, deletedAt } });
    conversationId = (await conversation('Mine', ids.Student)).id;
    othersConversationId = (await conversation('Theirs', ids.OtherStudent)).id;
    deletedConversationId = (await conversation('Deleted', ids.Student, new Date())).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@school.edu` } } });
    await prisma.school.deleteMany({ where: { name: { contains: 'Test E2E Ask School' } } });
    await app.close();
  });

  it('answers 201 with the pending answer, in the contract shape', async () => {
    const res = check(await ask(ids.Student, conversationId, { question: '  How does the chain rule work?  ' }), 201);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      conversationId,
      role: 'assistant',
      content: '',
      modelUsed: 'default',
      parameters: null,
      status: 'pending',
      notEnoughEvidence: false,
      citations: [],
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it('accepts a space filter', async () => {
    check(await ask(ids.Student, conversationId, { question: 'What is on the exam?', spaceIds: [spaceId] }), 201);
  });

  it.each([
    ['no question', {}],
    ['an empty question', { question: '   ' }],
    ['a question over 4000 characters', { question: 'x'.repeat(4001) }],
    ['an invalid space id', { question: 'Q', spaceIds: ['abc'] }],
    ['the same space twice', { question: 'Q', spaceIds: ['123e4567-e89b-42d3-a456-426614174011', '123e4567-e89b-42d3-a456-426614174011'] }],
    ['the old message body', { role: 'user', content: 'Q' }],
    ['a role chosen by the client', { question: 'Q', role: 'assistant' }],
    ['a model chosen by the client', { question: 'Q', modelUsed: 'gpt-4o' }],
  ])('refuses %s with 400', async (_label, body) => {
    check(await ask(ids.Student, conversationId, body), 400);
  });

  it("answers 404 for an unknown or deleted conversation, or someone else's, and 400 for an invalid id", async () => {
    check(await ask(ids.Student, othersConversationId, { question: 'Q' }), 404);
    check(await ask(ids.Student, deletedConversationId, { question: 'Q' }), 404);
    check(await ask(ids.Student, '00000000-0000-4000-8000-000000000000', { question: 'Q' }), 404);
    check(await ask(ids.Student, 'abc', { question: 'Q' }), 400);
  });

  it('publishes the contract in the OpenAPI document', async () => {
    const doc = (await http().get('/api/docs-json').expect(200)).body;
    const schema = (name: string) => doc.components.schemas[name];

    const route = doc.paths['/conversations/{id}/messages'].post;
    expect(route.requestBody.content['application/json'].schema.$ref).toBe('#/components/schemas/AskQuestionDto');
    expect(route.responses['201'].content['application/json'].schema.$ref).toBe('#/components/schemas/MessageEntity');
    expect(Object.keys(route.responses)).toEqual(expect.arrayContaining(['201', '400', '404']));

    expect(schema('AskQuestionDto').required).toEqual(['question']);
    expect(Object.keys(schema('AskQuestionDto').properties)).toEqual(['question', 'spaceIds']);
    expect(schema('MessageEntity').properties.status.enum).toEqual(['pending', 'generating', 'done', 'failed']);
    expect(schema('MessageEntity').required).toEqual(
      expect.arrayContaining(['content', 'status', 'modelUsed', 'notEnoughEvidence', 'citations', 'createdAt']),
    );
    expect(Object.keys(schema('MessageCitationEntity').properties)).toEqual([
      'id',
      'marker',
      'documentId',
      'versionId',
      'documentName',
      'versionNumber',
      'pageOrImageId',
      'excerpt',
      'zone',
      'available',
    ]);
    expect(Object.keys(schema('CitationZoneEntity').properties)).toEqual(['x', 'y', 'width', 'height']);
  });

  it('requires a token', async () => {
    await http().post(`/conversations/${conversationId}/messages`).send({ question: 'Q' }).expect(401);
  });
});
