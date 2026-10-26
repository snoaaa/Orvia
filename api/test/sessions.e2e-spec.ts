import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { UserStatus } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { SYSTEM_AUDIT_CONTEXT } from '../src/audit/utils/audit-request-context.util.js';
import { SessionService, type TokenPair } from '../src/auth/services/session.service.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/** Acceptance criteria of #12: rotation, reuse detection, logout, suspension, hashed storage. */
describe('Sessions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sessions: SessionService;
  const stamp = Date.now();
  let schoolId: string;
  let userId: string;
  let adminToken: string;

  const http = () => request(app.getHttpServer());
  const login = (id = userId): Promise<TokenPair> => sessions.createSession(id, SYSTEM_AUDIT_CONTEXT);
  const refresh = (refreshToken: string) => http().post('/auth/refresh').send({ refreshToken });

  async function createUser(key: string, status: UserStatus = 'ACTIVE'): Promise<string> {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'STUDENT' } });
    const user = await prisma.user.create({
      data: { email: `e2e-session-${key}-${stamp}@school.edu`, fullName: key, status },
    });
    await prisma.userAssignment.create({ data: { userId: user.id, roleId: role.id, schoolId } });
    return user.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    sessions = app.get(SessionService);

    schoolId = (await prisma.school.create({ data: { name: `Test E2E Session School ${stamp}` } })).id;
    userId = await createUser('main');
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
    });
    adminToken = (await app.get(TokenService).issueAccessToken(admin.id)).accessToken;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: 'e2e-session-' } } });
    await prisma.school.deleteMany({ where: { name: { contains: 'Test E2E Session School' } } });
    await app.close();
  });

  /** Moves the last rotation out of the reuse grace window (REFRESH_REUSE_GRACE_SECONDS, 10 s by default). */
  const endGraceWindow = (sessionId: string) =>
    prisma.session.update({ where: { id: sessionId }, data: { refreshRotatedAt: new Date(Date.now() - 60_000) } });

  it('a valid refresh token returns a new pair and the old one stops working', async () => {
    const first = await login();
    const res = await refresh(first.refreshToken).expect(200);
    expect(res.body.refreshToken).not.toBe(first.refreshToken);
    expect(res.body.sessionId).toBe(first.sessionId);
    await http().get('/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
    await endGraceWindow(first.sessionId);
    await refresh(first.refreshToken).expect(401);
  });

  it('reusing an old refresh token after the grace window revokes the whole session', async () => {
    const first = await login();
    const second = (await refresh(first.refreshToken).expect(200)).body;
    await endGraceWindow(first.sessionId);
    await refresh(first.refreshToken).expect(401);
    await refresh(second.refreshToken).expect(401);
    await http().get('/auth/me').set('Authorization', `Bearer ${second.accessToken}`).expect(401);
    const row = await prisma.session.findUniqueOrThrow({ where: { id: first.sessionId } });
    expect(row.revokedAt).not.toBeNull();
  });

  it('accepts a retry with the just-replaced token within the grace window (lost response)', async () => {
    const first = await login();
    await refresh(first.refreshToken).expect(200); // response "lost" on the network
    const retry = (await refresh(first.refreshToken).expect(200)).body; // client retries with what it has
    await http().get('/auth/me').set('Authorization', `Bearer ${retry.accessToken}`).expect(200);
    const next = (await refresh(retry.refreshToken).expect(200)).body;
    expect(next.sessionId).toBe(first.sessionId);
    const row = await prisma.session.findUniqueOrThrow({ where: { id: first.sessionId } });
    expect(row.revokedAt).toBeNull();
  });

  it('accepts two simultaneous refreshes with the same token without revoking the session', async () => {
    const first = await login();
    const [a, b] = await Promise.all([refresh(first.refreshToken), refresh(first.refreshToken)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const row = await prisma.session.findUniqueOrThrow({ where: { id: first.sessionId } });
    expect(row.revokedAt).toBeNull();
  });

  it('rejects a token two rotations old even within the grace window', async () => {
    const first = await login();
    const second = (await refresh(first.refreshToken).expect(200)).body;
    await refresh(second.refreshToken).expect(200);
    await refresh(first.refreshToken).expect(401);
    const row = await prisma.session.findUniqueOrThrow({ where: { id: first.sessionId } });
    expect(row.revokedAt).not.toBeNull();
  });

  it('rejects malformed and unknown refresh tokens', async () => {
    await refresh('not-a-token').expect(401);
    await refresh(`00000000-0000-4000-8000-000000000000.${'x'.repeat(43)}`).expect(401);
  });

  it('after logout the refresh token no longer works', async () => {
    const pair = await login();
    await http().post('/auth/logout').set('Authorization', `Bearer ${pair.accessToken}`).expect(204);
    await refresh(pair.refreshToken).expect(401);
    await http().get('/auth/me').set('Authorization', `Bearer ${pair.accessToken}`).expect(401);
  });

  it('a suspended user cannot refresh', async () => {
    const suspendedId = await createUser('suspended');
    const pair = await login(suspendedId);
    await prisma.user.update({ where: { id: suspendedId }, data: { status: 'SUSPENDED' } });
    const res = await refresh(pair.refreshToken).expect(403);
    expect(res.body.message).toBe('Account suspended');
  });

  it('suspending a user through the API revokes all their sessions', async () => {
    const id = await createUser('to-suspend');
    const a = await login(id);
    const b = await login(id);
    await http()
      .patch(`/identity/users/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'SUSPENDED' })
      .expect(200);
    await refresh(a.refreshToken).expect(401);
    await refresh(b.refreshToken).expect(401);
    expect(await prisma.session.count({ where: { userId: id, revokedAt: null } })).toBe(0);
  });

  it('stores refresh tokens hashed only', async () => {
    const pair = await login();
    const row = await prisma.session.findUniqueOrThrow({ where: { id: pair.sessionId } });
    const secret = pair.refreshToken.split('.')[1];
    expect(row.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.refreshTokenHash).not.toContain(secret);
  });

  it('lists my active sessions and lets me revoke one', async () => {
    const mine = await login();
    const other = await login();
    const res = await http().get('/auth/sessions').set('Authorization', `Bearer ${mine.accessToken}`).expect(200);
    const ids = res.body.map((s: { id: string }) => s.id);
    expect(ids).toEqual(expect.arrayContaining([mine.sessionId, other.sessionId]));
    expect(res.body.find((s: { id: string }) => s.id === mine.sessionId).current).toBe(true);

    await http()
      .delete(`/auth/sessions/${other.sessionId}`)
      .set('Authorization', `Bearer ${mine.accessToken}`)
      .expect(204);
    await refresh(other.refreshToken).expect(401);
  });

  it('lets an admin list and revoke all sessions of a user', async () => {
    const id = await createUser('admin-revoke');
    const pair = await login(id);
    const list = await http()
      .get(`/identity/users/${id}/sessions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(list.body.map((s: { id: string }) => s.id)).toContain(pair.sessionId);

    const res = await http()
      .delete(`/identity/users/${id}/sessions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.revoked).toBe(1);
    await refresh(pair.refreshToken).expect(401);
  });

  it('cleans up sessions expired longer than the retention period', async () => {
    const pair = await login();
    await prisma.session.update({
      where: { id: pair.sessionId },
      data: { expiresAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) },
    });
    expect(await sessions.deleteStaleSessions()).toBeGreaterThanOrEqual(1);
    expect(await prisma.session.findUnique({ where: { id: pair.sessionId } })).toBeNull();
  });
});
