import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { AuditService } from '../src/audit/services/audit.service.js';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';
import { PrismaService } from '../src/database/prisma.service.js';

describe('Audit trail (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const previousDevTools = process.env.AUDIT_DEV_TOOLS;

  beforeAll(async () => {
    process.env.AUDIT_DEV_TOOLS = 'true';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new HttpExceptionFilter(app.get(AuditService)));
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    process.env.AUDIT_DEV_TOOLS = previousDevTools;
    await prisma.user.deleteMany({ where: { email: { contains: 'test-e2e-audit' } } });
    await app.close();
  });

  // Other e2e files run in parallel and also write audit rows, so each test tags its
  // requests with a unique device id and only counts its own rows.
  const tag = (name: string) => `e2e-audit-${name}-${Date.now()}`;
  const countFor = (deviceId: string) => prisma.auditEvent.count({ where: { deviceId } });

  it('records a failed login with email and IP but never the password', async () => {
    const device = tag('login');
    const res = await request(app.getHttpServer())
      .post('/audit/dev/simulate/login-failure')
      .set('x-device-id', device)
      .send({ email: 'test-e2e-audit@school.edu', password: 'S3cret-should-not-leak' })
      .expect(201);

    expect(await countFor(device)).toBe(1);
    expect(res.body).toMatchObject({ category: 'authentication', action: 'login_failure' });
    expect(res.body.ip).toBeTruthy();
    expect(res.body.details.email).toBe('test-e2e-audit@school.edu');
    const row = await prisma.auditEvent.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toContain(
      'S3cret-should-not-leak',
    );
  });

  it('records exactly one access_denied row per 403', async () => {
    const device = tag('403');
    await request(app.getHttpServer()).get('/audit/dev/forbidden').set('x-device-id', device).expect(403);
    const rows = await prisma.auditEvent.findMany({ where: { deviceId: device } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ category: 'security', action: 'access_denied' });
  });

  it('records user_invited when a user is created', async () => {
    const device = tag('invite');
    const email = `test-e2e-audit-${Date.now()}@school.edu`;
    const res = await request(app.getHttpServer())
      .post('/identity/users')
      .set('x-device-id', device)
      .send({ email, fullName: 'Audit E2E', password: 'Password123!' })
      .expect(201);
    const rows = await prisma.auditEvent.findMany({ where: { deviceId: device } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ category: 'identity_access', action: 'user_invited', entityId: res.body.id });
    expect(JSON.stringify(rows[0].details)).not.toContain('Password123!');
  });

  it('keeps a valid hash chain under concurrent writes', async () => {
    await Promise.all(
      Array.from({ length: 20 }, () =>
        request(app.getHttpServer()).post('/audit/dev/simulate/login-success').send({}).expect(201),
      ),
    );
    const res = await request(app.getHttpServer()).get('/audit/verify').expect(200);
    expect(res.body.valid).toBe(true);
  });

  it('exposes no endpoint to create, modify or delete audit events', async () => {
    await request(app.getHttpServer()).post('/audit/events').send({}).expect(404);
    await request(app.getHttpServer()).patch('/audit/events').send({}).expect(404);
    await request(app.getHttpServer()).delete('/audit/events').expect(404);
  });
});
