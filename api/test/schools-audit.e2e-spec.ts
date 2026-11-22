import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/**
 * School and domain audit trail (#5, §4.5 non-repudiation).
 *
 * The issue's acceptance criteria are the spine: every action (create, edit, deactivate, reactivate,
 * domain added, domain removed) writes **exactly one** `identity_access` row, with the actor, the school
 * and the before/after values in `details` — and no secret ever survives in `details`.
 */
describe('School and domain audit (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const stamp = Date.now();
  const schoolName = `Test E2E School Audit ${stamp}`;
  const baseDomain = `audit-${stamp}.edu`;
  const extraDomain = `extra-${stamp}.edu`;
  let platformAdminId: string;
  let schoolId: string;

  const http = () => request(app.getHttpServer());
  const bearer = async (id: string) => `Bearer ${(await tokens.issueAccessToken(id)).accessToken}`;
  const check = <T extends { status: number; body: unknown }>(res: T, status: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    return res;
  };
  const post = async (path: string, body: object) =>
    http().post(path).set('Authorization', await bearer(platformAdminId)).send(body);
  const patch = async (path: string, body: object = {}) =>
    http().patch(path).set('Authorization', await bearer(platformAdminId)).send(body);
  const del = async (path: string) =>
    http().delete(path).set('Authorization', await bearer(platformAdminId));

  /** Exactly the rows this action recorded for the school, newest last. */
  const rowsFor = (action: string, id = schoolId) =>
    prisma.auditEvent.findMany({ where: { action, entityId: id }, orderBy: { seq: 'asc' } });
  const countFor = async (action: string, id = schoolId) =>
    prisma.auditEvent.count({ where: { action, entityId: id } });
  const latest = async (action: string, id = schoolId) =>
    (await rowsFor(action, id)).at(-1);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    platformAdminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
      })
    ).id;

    // One school for the whole file; the audit rows it produces are unique to its id.
    const created = check(
      await post('/schools', {
        name: schoolName,
        allowedDomains: baseDomain,
        // `settings` is free-form: a secret stored there must never reach the audit details.
        settings: { maxStudents: 500, apiKey: 'super-secret-value', nested: { password: 'p4ssw0rd' } },
      }),
      201,
    ).body;
    schoolId = created.id;
  });

  afterAll(async () => {
    await prisma.school.deleteMany({ where: { name: { contains: String(stamp) } } });
    await app.close();
  });

  it('records the creation with the actor and the starting snapshot', async () => {
    const rows = await rowsFor('school_created');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      category: 'identity_access',
      entityType: 'school',
      entityId: schoolId,
      actorId: platformAdminId,
      actorRole: 'PLATFORM_ADMIN',
    });
    expect(rows[0].details).toMatchObject({
      school: schoolName,
      before: null,
      after: { name: schoolName, status: 'active', domains: [baseDomain] },
    });
  });

  it('never stores a secret from settings in details', async () => {
    const created = (await latest('school_created'))!;
    const after = (created.details as { after: { settings: Record<string, unknown> } }).after;

    expect(after.settings).toMatchObject({
      maxStudents: 500,
      apiKey: '[REDACTED]',
      nested: { password: '[REDACTED]' },
    });
    expect(JSON.stringify(created.details)).not.toContain('super-secret-value');
    expect(JSON.stringify(created.details)).not.toContain('p4ssw0rd');
  });

  it('records an edit once, with the fields that changed as before/after', async () => {
    check(await patch(`/schools/${schoolId}`, { name: `${schoolName} (renamed)`, settings: { maxStudents: 900 } }), 200);

    const rows = await rowsFor('school_updated');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: platformAdminId, entityId: schoolId });
    expect(rows[0].details).toMatchObject({
      school: `${schoolName} (renamed)`,
      changes: {
        name: { before: schoolName, after: `${schoolName} (renamed)` },
        settings: { before: { maxStudents: 500, apiKey: '[REDACTED]', nested: { password: '[REDACTED]' } }, after: { maxStudents: 900 } },
      },
    });
    // The domain set did not move, so it is not part of the diff.
    expect((rows[0].details as { changes: Record<string, unknown> }).changes).not.toHaveProperty('domains');
  });

  it('writes nothing for an edit that changes nothing', async () => {
    check(await patch(`/schools/${schoolId}`, { name: `${schoolName} (renamed)` }), 200);

    expect(await countFor('school_updated')).toBe(1);
  });

  it('records a deactivation and a reactivation, once each, and ignores a repeated call', async () => {
    check(await patch(`/schools/${schoolId}/deactivate`), 200);
    check(await patch(`/schools/${schoolId}/deactivate`), 200);

    const deactivated = await rowsFor('school_deactivated');
    expect(deactivated).toHaveLength(1);
    expect(deactivated[0].details).toMatchObject({
      school: `${schoolName} (renamed)`,
      changes: { status: { before: 'active', after: 'deactivated' } },
    });

    check(await patch(`/schools/${schoolId}/reactivate`), 200);
    check(await patch(`/schools/${schoolId}/reactivate`), 200);

    const reactivated = await rowsFor('school_reactivated');
    expect(reactivated).toHaveLength(1);
    expect(reactivated[0].details).toMatchObject({
      changes: { status: { before: 'deactivated', after: 'active' } },
    });
  });

  it('records a domain added with the allowed-domain set before and after', async () => {
    check(await post(`/schools/${schoolId}/domains`, { domain: extraDomain }), 201);

    const rows = await rowsFor('school_domain_added');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: platformAdminId, entityType: 'school', entityId: schoolId });
    expect(rows[0].details).toMatchObject({
      school: `${schoolName} (renamed)`,
      domain: extraDomain,
      changes: { domains: { before: [baseDomain], after: [baseDomain, extraDomain] } },
    });
  });

  it('records a domain removed with the allowed-domain set before and after', async () => {
    const domains = check(await http().get(`/schools/${schoolId}/domains`).set('Authorization', await bearer(platformAdminId)), 200)
      .body as Array<{ id: string; domain: string }>;
    const target = domains.find((domain) => domain.domain === extraDomain)!;

    check(await del(`/schools/${schoolId}/domains/${target.id}`), 204);

    const rows = await rowsFor('school_domain_removed');
    expect(rows).toHaveLength(1);
    expect(rows[0].details).toMatchObject({
      school: `${schoolName} (renamed)`,
      domain: extraDomain,
      changes: { domains: { before: [baseDomain, extraDomain], after: [baseDomain] } },
    });
  });

  it('replaces the whole domain list through PATCH as one school_updated row, not as domain events', async () => {
    // Replacing the list is an edit of the school, so it must not fabricate domain_added/removed rows.
    check(await patch(`/schools/${schoolId}`, { allowedDomains: `${extraDomain},${baseDomain}` }), 200);

    expect(await countFor('school_updated')).toBe(2);
    expect(await countFor('school_domain_added')).toBe(1);
    expect(await countFor('school_domain_removed')).toBe(1);
    expect((await latest('school_updated'))!.details).toMatchObject({
      changes: { domains: { before: [baseDomain], after: [baseDomain, extraDomain] } },
    });
  });

  it('writes exactly one row per action, none from the reads in between', async () => {
    const counts = {
      school_created: await countFor('school_created'),
      school_updated: await countFor('school_updated'),
      school_deactivated: await countFor('school_deactivated'),
      school_reactivated: await countFor('school_reactivated'),
      school_domain_added: await countFor('school_domain_added'),
      school_domain_removed: await countFor('school_domain_removed'),
    };

    expect(counts).toEqual({
      school_created: 1,
      school_updated: 2,
      school_deactivated: 1,
      school_reactivated: 1,
      school_domain_added: 1,
      school_domain_removed: 1,
    });
    // Every one of them is an identity_access row about this school.
    expect(await prisma.auditEvent.count({ where: { entityId: schoolId, category: 'identity_access' } })).toBe(7);
  });
});
