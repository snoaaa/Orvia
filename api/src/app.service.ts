import { Injectable } from '@nestjs/common';
import { PrismaService } from './database/prisma.service.js';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  getHello(): { message: string; version: string; docs: string } {
    return {
      message: 'Welcome to WAMDP Backend API (NestJS + MySQL 8 + Prisma)',
      version: '1.0.0',
      docs: '/api/docs',
    };
  }

  async getHealth(): Promise<{
    status: string;
    timestamp: string;
    database: {
      status: 'ok' | 'error';
      message: string;
      timestamp: string;
    };
  }> {
    const dbHealth = await this.prisma.checkHealth();
    return {
      status: dbHealth.status === 'ok' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      database: dbHealth,
    };
  }
}
