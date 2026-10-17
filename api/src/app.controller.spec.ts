import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaService } from './database/prisma.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeAll(async () => {
    const mockPrismaService = {
      checkHealth: vi.fn().mockResolvedValue({
        status: 'ok',
        message: 'Database connection to MySQL 8 is healthy.',
        timestamp: new Date().toISOString(),
      }),
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return welcome message with version and docs', () => {
      const response = appController.getHello();
      expect(response).toHaveProperty('message');
      expect(response.message).toContain('WAMDP Backend API');
      expect(response.docs).toBe('/api/docs');
    });
  });

  describe('health', () => {
    it('should return database health status', async () => {
      const health = await appController.getHealth();
      expect(health.status).toBe('ok');
      expect(health.database.status).toBe('ok');
    });
  });
});
