import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Successfully connected to MySQL 8 database via Prisma.');
    } catch (error) {
      this.logger.error('Failed to connect to MySQL database:', error);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Disconnected from MySQL database.');
  }

  async checkHealth(): Promise<{ status: 'ok' | 'error'; message: string; timestamp: string }> {
    try {
      await this.$queryRaw`SELECT 1`;
      return {
        status: 'ok',
        message: 'Database connection to MySQL 8 is healthy.',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        status: 'error',
        message: `Database connection failed: ${errMessage}`,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
