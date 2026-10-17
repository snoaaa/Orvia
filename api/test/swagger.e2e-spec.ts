import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { setupSwagger } from './../src/config/swagger/index.js';

describe('Swagger Documentation & Protection (e2e)', () => {
  describe('Standard Swagger Configuration', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      app = moduleFixture.createNestApplication();

      setupSwagger(app, {
        enabled: true,
        protected: false,
        path: 'api/docs',
      });

      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('should serve OpenAPI JSON specification at /api/docs-json', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);

      expect(res.body).toHaveProperty('openapi');
      expect(res.body.info.title).toBe('WAMDP Backend API');
    });

    it('should include Bearer JWT security scheme in components', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);

      const securitySchemes = res.body.components?.securitySchemes;
      expect(securitySchemes).toBeDefined();
      expect(securitySchemes).toHaveProperty('bearer-jwt');
      expect(securitySchemes['bearer-jwt'].type).toBe('http');
      expect(securitySchemes['bearer-jwt'].scheme).toBe('bearer');
      expect(securitySchemes['bearer-jwt'].bearerFormat).toBe('JWT');
    });

    it('should document domain tags', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);

      const tagNames = res.body.tags?.map((t: { name: string }) => t.name) || [];
      expect(tagNames).toContain('Identity and Access');
      expect(tagNames).toContain('Documents');
      expect(tagNames).toContain('Conversations');
      expect(tagNames).toContain('RAG Performance');
      expect(tagNames).toContain('Mobile & Synchronization');
      expect(tagNames).toContain('Audit Trail');
    });
  });

  describe('Swagger Basic Auth Protection', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      app = moduleFixture.createNestApplication();

      setupSwagger(app, {
        enabled: true,
        protected: true,
        user: 'admin',
        password: 'secure_password_123',
        path: 'api/docs',
      });

      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('should block unauthenticated access with 401 when protection is enabled', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(401);

      expect(res.headers['www-authenticate']).toContain('Basic');
      expect(res.body.message).toContain('Unauthorized');
    });

    it('should reject invalid credentials with 401', async () => {
      const wrongCredentials = Buffer.from('admin:wrong_password').toString('base64');
      await request(app.getHttpServer())
        .get('/api/docs-json')
        .set('Authorization', `Basic ${wrongCredentials}`)
        .expect(401);
    });

    it('should allow access with valid credentials', async () => {
      const validCredentials = Buffer.from('admin:secure_password_123').toString('base64');
      const res = await request(app.getHttpServer())
        .get('/api/docs-json')
        .set('Authorization', `Basic ${validCredentials}`)
        .expect(200);

      expect(res.body.info.title).toBe('WAMDP Backend API');
    });
  });

  describe('Disabling Swagger in Production', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      app = moduleFixture.createNestApplication();

      const wasMounted = setupSwagger(app, {
        enabled: false,
        path: 'api/docs',
      });

      expect(wasMounted).toBe(false);
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('should return 404 when Swagger is disabled', async () => {
      await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(404);
    });
  });
});
