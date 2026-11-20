import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { TokenService } from '../src/auth/services/token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

/** POST /documents/spaces and PATCH /documents/spaces/:id (#97): who can do it where, validation, unique names, audit. */
describe('Create and update a space (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const stamp = Date.now();
  const schools = { A: '', B: '' };
  const ids: Record<string, string> = {};
  let platformAdminId: string;
  let counter = 0;

  const http = () => request(app.getHttpServer());
  const bearer = async (id: string) => `Bearer ${(await tokens.issueAccessToken(id)).accessToken}`;
  const create = async (as: string, body: object) =>
    http().post('/documents/spaces').set('Authorization', await bearer(as)).send(body);
  const update = async (as: string, id: string, body: object) =>
    http().patch(`/documents/spaces/${id}`).set('Authorization', await bearer(as)).send(body);
  /** Asserts the HTTP status (with the body in the failure message) and returns the response. */
  const check = <T extends { status: number; body: unknown }>(res: T, status: number): T => {
    expect({ status: res.status, body: res.body }).toMatchObject({ status });
    return res;
  };
  const uniqueName = (label: string) => `${label} ${stamp}-${++counter}`;
  /** A space inserted directly, to test updates without depending on the create endpoint. */
  const space = async (school: keyof typeof schools, data: { name?: string; description?: string | null } = {}) =>
    prisma.space.create({
      data: { schoolId: schools[school], name: data.name ?? uniqueName('Space'), description: data.description ?? null },
    });
  const stored = async (id: string) => prisma.space.findUniqueOrThrow({ where: { id } });
  const auditOf = async (action: string, spaceId: string) =>
    prisma.auditEvent.findMany({ where: { action, entityType: 'space', entityId: spaceId }, orderBy: { seq: 'asc' } });

  type Assignment = { school: keyof typeof schools; role: string };
  async function user(key: string, assignments: Assignment[]) {
    const created = await prisma.user.create({
      data: { email: `e2e-spaces-${key.toLowerCase()}-${stamp}@school.edu`, fullName: key, status: 'ACTIVE' },
    });
    for (const a of assignments) {
      const role = await prisma.role.findUniqueOrThrow({ where: { name: a.role } });
      await prisma.userAssignment.create({ data: { userId: created.id, schoolId: schools[a.school], roleId: role.id } });
    }
    ids[key] = created.id;
    return created.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    schools.A = (await prisma.school.create({ data: { name: `Test E2E Spaces School A ${stamp}` } })).id;
    schools.B = (await prisma.school.create({ data: { name: `Test E2E Spaces School B ${stamp}` } })).id;

    await user('AdminA', [{ school: 'A', role: 'SCHOOL_ADMIN' }]);
    // Staff with document-management rights (#88) hold CONTENT_MANAGER in the school.
    await user('ManagerA', [{ school: 'A', role: 'CONTENT_MANAGER' }]);
    await user('ManagerAStaffB', [
      { school: 'A', role: 'CONTENT_MANAGER' },
      { school: 'B', role: 'STAFF' },
    ]);
    await user('StaffA', [{ school: 'A', role: 'STAFF' }]);
    await user('StudentA', [{ school: 'A', role: 'STUDENT' }]);
    await user('GuestA', [{ school: 'A', role: 'PARENT_GUEST' }]);

    platformAdminId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: process.env.PLATFORM_ADMIN_EMAIL || 'admin@wamdp.platform' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: `-${stamp}@` } } });
    // Deleting the schools cascades to their spaces.
    await prisma.school.deleteMany({ where: { name: { contains: 'Test E2E Spaces School' } } });
    await app.close();
  });

  describe('POST /documents/spaces', () => {
    describe('access', () => {
      it('requires a token', async () => {
        await http().post('/documents/spaces').send({ schoolId: schools.A, name: uniqueName('Anonymous') }).expect(401);
      });

      it.each(['StaffA', 'StudentA', 'GuestA'])('rejects %s (no space rights)', async (key) => {
        const name = uniqueName(`Refused ${key}`);
        check(await create(ids[key], { schoolId: schools.A, name }), 403);
        expect(await prisma.space.count({ where: { name } })).toBe(0);
      });

      it('a platform admin creates a space in any school', async () => {
        const res = check(await create(platformAdminId, { schoolId: schools.B, name: uniqueName('Platform') }), 201);
        expect(res.body.schoolId).toBe(schools.B);
      });

      it.each(['AdminA', 'ManagerA'])('%s creates a space in their school', async (key) => {
        const res = check(await create(ids[key], { schoolId: schools.A, name: uniqueName(key) }), 201);
        expect(res.body.schoolId).toBe(schools.A);
      });

      it.each(['AdminA', 'ManagerA'])('%s cannot create a space in another school', async (key) => {
        const name = uniqueName(`Cross ${key}`);
        check(await create(ids[key], { schoolId: schools.B, name }), 403);
        expect(await prisma.space.count({ where: { name } })).toBe(0);
      });

      it('document-management rights only count in the school where they are held', async () => {
        check(await create(ids.ManagerAStaffB, { schoolId: schools.A, name: uniqueName('Held') }), 201);
        check(await create(ids.ManagerAStaffB, { schoolId: schools.B, name: uniqueName('Not held') }), 403);
      });

      it('returns 404 for an unknown school (platform admin) and 403 for a scoped user', async () => {
        const body = { schoolId: '00000000-0000-4000-8000-000000000000', name: uniqueName('Nowhere') };
        check(await create(platformAdminId, body), 404);
        check(await create(ids.AdminA, body), 403);
      });
    });

    describe('result', () => {
      it('defaults to language en and privacy public, with an empty description', async () => {
        const name = uniqueName('Defaults');
        const res = check(await create(ids.AdminA, { schoolId: schools.A, name }), 201);

        expect(res.body).toMatchObject({ schoolId: schools.A, name, description: '', language: 'en', privacy: 'public' });
        expect(await stored(res.body.id)).toMatchObject({ description: null, language: 'en', privacy: 'public' });
      });

      it('saves a language sent in upper case as lower case', async () => {
        const name = uniqueName('Upper');
        const res = check(await create(ids.ManagerA, { schoolId: schools.A, name, language: ' FR ' }), 201);

        expect(res.body.language).toBe('fr');
        expect(await stored(res.body.id)).toMatchObject({ language: 'fr' });

        const upd = check(await update(ids.ManagerA, res.body.id, { language: 'EN' }), 200);
        expect(upd.body.language).toBe('en');
        expect(await stored(res.body.id)).toMatchObject({ language: 'en' });
      });

      it('stores the description, language and privacy, and trims the name', async () => {
        const name = uniqueName('Droit');
        const res = check(
          await create(ids.ManagerA, {
            schoolId: schools.A,
            name: `  ${name}  `,
            description: 'Cours de droit',
            language: 'fr',
            privacy: 'restricted',
          }),
          201,
        );

        expect(res.body).toMatchObject({ name, description: 'Cours de droit', language: 'fr', privacy: 'restricted' });
        const read = await http().get(`/documents/spaces/${res.body.id}`).set('Authorization', await bearer(ids.AdminA));
        expect(check(read, 200).body).toMatchObject({ name, language: 'fr', privacy: 'restricted' });
      });

      it('writes one space_created audit event', async () => {
        const name = uniqueName('Audited');
        const res = check(await create(ids.ManagerA, { schoolId: schools.A, name, privacy: 'private' }), 201);

        const events = await auditOf('space_created', res.body.id);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ category: 'documents', actorId: ids.ManagerA, actorRole: 'CONTENT_MANAGER' });
        expect(events[0].details).toMatchObject({ schoolId: schools.A, name, language: 'en', privacy: 'private' });
      });
    });

    describe('validation (400)', () => {
      it.each([
        ['no schoolId', () => ({ name: 'No school' })],
        ['a schoolId that is not a UUID', () => ({ schoolId: 'school-a', name: 'Bad school' })],
        ['no name', (schoolId: string) => ({ schoolId })],
        ['a blank name', (schoolId: string) => ({ schoolId, name: '   ' })],
        ['a name over 100 characters', (schoolId: string) => ({ schoolId, name: 'x'.repeat(101) })],
        ['a description over 2000 characters', (schoolId: string) => ({ schoolId, name: 'Long', description: 'x'.repeat(2001) })],
        ['an unknown language', (schoolId: string) => ({ schoolId, name: 'Bad language', language: 'de' })],
        ['an unknown privacy level', (schoolId: string) => ({ schoolId, name: 'Bad privacy', privacy: 'secret' })],
        ['an unknown field', (schoolId: string) => ({ schoolId, name: 'Extra field', owner: 'me' })],
      ] as [string, (schoolId: string) => object][])('rejects %s', async (_label, body) => {
        const before = await prisma.space.count({ where: { schoolId: schools.A } });
        check(await create(ids.AdminA, body(schools.A)), 400);
        expect(await prisma.space.count({ where: { schoolId: schools.A } })).toBe(before);
      });

      it('no longer picks or creates a school when schoolId is missing, even for a platform admin', async () => {
        const schoolsBefore = await prisma.school.count();
        const name = uniqueName('No school platform');
        check(await create(platformAdminId, { name }), 400);
        expect(await prisma.school.count()).toBe(schoolsBefore);
        expect(await prisma.space.count({ where: { name } })).toBe(0);
      });
    });

    describe('unique name per school (409)', () => {
      it('rejects a name already used in the school', async () => {
        const name = uniqueName('Taken');
        check(await create(ids.AdminA, { schoolId: schools.A, name }), 201);

        const res = check(await create(ids.ManagerA, { schoolId: schools.A, name }), 409);

        expect(res.body.message).toBe(`A space named '${name}' already exists in this school`);
        expect(await prisma.space.count({ where: { schoolId: schools.A, name } })).toBe(1);
      });

      it('allows the same name in another school', async () => {
        const name = uniqueName('Shared');
        check(await create(platformAdminId, { schoolId: schools.A, name }), 201);
        check(await create(platformAdminId, { schoolId: schools.B, name }), 201);
      });

      it('two simultaneous requests cannot both succeed (unique index)', async () => {
        const name = uniqueName('Race');
        const results = await Promise.all([
          create(ids.AdminA, { schoolId: schools.A, name }),
          create(ids.ManagerA, { schoolId: schools.A, name }),
        ]);

        expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 409]);
        expect(await prisma.space.count({ where: { schoolId: schools.A, name } })).toBe(1);
      });
    });
  });

  describe('PATCH /documents/spaces/:id', () => {
    describe('access', () => {
      it('requires a token', async () => {
        const target = await space('A');
        await http().patch(`/documents/spaces/${target.id}`).send({ name: uniqueName('Anonymous') }).expect(401);
      });

      it.each(['StaffA', 'StudentA', 'GuestA'])('rejects %s (no space rights)', async (key) => {
        const target = await space('A');
        check(await update(ids[key], target.id, { name: uniqueName('Refused') }), 403);
        expect((await stored(target.id)).name).toBe(target.name);
      });

      it('a platform admin updates a space of any school', async () => {
        const target = await space('B');
        const res = check(await update(platformAdminId, target.id, { privacy: 'private' }), 200);
        expect(res.body.privacy).toBe('private');
      });

      it.each(['AdminA', 'ManagerA'])('%s updates a space of their school', async (key) => {
        const target = await space('A');
        const name = uniqueName(`Renamed by ${key}`);
        const res = check(await update(ids[key], target.id, { name }), 200);
        expect(res.body.name).toBe(name);
      });

      it.each(['AdminA', 'ManagerA', 'ManagerAStaffB'])("%s cannot update another school's space", async (key) => {
        const target = await space('B');
        check(await update(ids[key], target.id, { name: uniqueName('Cross') }), 403);
        expect((await stored(target.id)).name).toBe(target.name);
        expect(await auditOf('space_updated', target.id)).toHaveLength(0);
      });

      it('rejects an invalid UUID with 400', async () => {
        check(await update(platformAdminId, 'not-a-uuid', { name: uniqueName('Bad id') }), 400);
      });

      it('returns 404 for an unknown space', async () => {
        check(await update(platformAdminId, '00000000-0000-4000-8000-000000000000', { name: uniqueName('Missing') }), 404);
      });
    });

    describe('result', () => {
      it('updates only the given fields and keeps the school', async () => {
        const target = await space('A', { description: 'Original description' });
        const name = uniqueName('Edited');

        const res = check(await update(ids.ManagerA, target.id, { name, language: 'fr', privacy: 'restricted' }), 200);

        expect(res.body).toMatchObject({
          id: target.id,
          schoolId: schools.A,
          name,
          description: 'Original description',
          language: 'fr',
          privacy: 'restricted',
        });
        expect(await stored(target.id)).toMatchObject({ schoolId: schools.A, name, language: 'fr', privacy: 'restricted' });
      });

      it.each([null, ''])('clears the description with %j', async (description) => {
        const target = await space('A', { description: 'To remove' });
        const res = check(await update(ids.AdminA, target.id, { description }), 200);
        expect(res.body.description).toBe('');
        expect((await stored(target.id)).description).toBeNull();
      });

      it('writes one space_updated audit event with the previous and new values of the changed fields', async () => {
        const target = await space('A');
        const name = uniqueName('Audited edit');

        check(await update(ids.AdminA, target.id, { name, privacy: 'private', language: 'en' }), 200);

        const events = await auditOf('space_updated', target.id);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ category: 'documents', actorId: ids.AdminA, actorRole: 'SCHOOL_ADMIN' });
        // language was already 'en': it is not a change.
        expect(events[0].details).toEqual({
          schoolId: schools.A,
          changes: { name: { from: target.name, to: name }, privacy: { from: 'public', to: 'private' } },
        });
      });

      it('sending the current values returns 200 without a write or an audit event', async () => {
        const target = await space('A');
        const res = check(await update(ids.AdminA, target.id, { name: target.name, privacy: 'public' }), 200);

        expect(res.body.name).toBe(target.name);
        expect((await stored(target.id)).updatedAt.getTime()).toBe(target.updatedAt.getTime());
        expect(await auditOf('space_updated', target.id)).toHaveLength(0);
      });
    });

    describe('validation (400)', () => {
      it.each([
        ['an empty body', {}],
        ['a blank name', { name: '   ' }],
        ['a null name', { name: null }],
        ['a name over 100 characters', { name: 'x'.repeat(101) }],
        ['a description over 2000 characters', { description: 'x'.repeat(2001) }],
        ['an unknown language', { language: 'de' }],
        ['an unknown privacy level', { privacy: 'secret' }],
        ['an unknown field', { owner: 'me' }],
      ])('rejects %s', async (_label, body) => {
        const target = await space('A');
        check(await update(ids.AdminA, target.id, body), 400);
        expect(await stored(target.id)).toMatchObject({ name: target.name, language: 'en', privacy: 'public' });
      });

      it('the school of a space cannot be changed', async () => {
        const target = await space('A');
        check(await update(platformAdminId, target.id, { name: uniqueName('Moved'), schoolId: schools.B }), 400);
        expect(await stored(target.id)).toMatchObject({ schoolId: schools.A, name: target.name });
      });
    });

    describe('unique name per school (409)', () => {
      it('rejects the name of another space of the same school', async () => {
        const other = await space('A');
        const target = await space('A');

        const res = check(await update(ids.AdminA, target.id, { name: other.name }), 409);

        expect(res.body.message).toBe(`A space named '${other.name}' already exists in this school`);
        expect((await stored(target.id)).name).toBe(target.name);
        expect(await auditOf('space_updated', target.id)).toHaveLength(0);
      });

      it("accepts the name of another school's space", async () => {
        const other = await space('B');
        const target = await space('A');
        check(await update(ids.AdminA, target.id, { name: other.name }), 200);
      });

      it('accepts a change of letter case of its own name', async () => {
        const target = await space('A', { name: uniqueName('lower case') });
        const name = target.name.toUpperCase();
        const res = check(await update(ids.AdminA, target.id, { name }), 200);
        expect(res.body.name).toBe(name);
      });
    });
  });
});
