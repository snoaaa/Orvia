import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { RagPerformanceService } from './rag-performance.service.js';

describe('RagPerformanceService (#89)', () => {
  let service: RagPerformanceService;
  let mockPrisma: any;

  const schoolAdminActor: AuthenticatedUser = {
    id: 'user-admin',
    sessionId: 'session-1',
    email: 'admin@school-a.edu',
    fullName: 'School Admin',
    status: 'ACTIVE',
    isPlatformAdmin: false,
    permissions: ['metrics:view'],
    schoolIds: ['school-a'],
    assignments: [
      {
        role: 'SCHOOL_ADMIN',
        scope: 'school',
        schoolId: 'school-a',
        schoolStatus: 'active',
        groupId: null,
        permissions: ['metrics:view'],
      },
    ],
  };

  const platformAdminActor: AuthenticatedUser = {
    id: 'user-platform',
    sessionId: 'session-2',
    email: 'platform@orvia.com',
    fullName: 'Platform Admin',
    status: 'ACTIVE',
    isPlatformAdmin: true,
    permissions: ['*'],
    schoolIds: [],
    assignments: [
      {
        role: 'PLATFORM_ADMIN',
        scope: 'platform',
        schoolId: null,
        schoolStatus: null,
        groupId: null,
        permissions: ['*'],
      },
    ],
  };

  beforeEach(() => {
    mockPrisma = {};
    service = new RagPerformanceService(mockPrisma as unknown as PrismaService);
  });

  it('allows school admin to view metrics for their own school', async () => {
    const metrics = await service.findAllMetrics({ schoolId: 'school-a' }, schoolAdminActor);
    expect(metrics).toHaveLength(1);
    expect(metrics[0].status).toBe('success');
  });

  it('throws 403 Forbidden when school admin queries metrics for another school', async () => {
    await expect(
      service.findAllMetrics({ schoolId: 'school-other' }, schoolAdminActor),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows platform admin to view metrics for any school', async () => {
    const metrics = await service.findAllMetrics({ schoolId: 'school-other' }, platformAdminActor);
    expect(metrics).toHaveLength(1);
  });

  it('allows platform admin to view metrics without specifying schoolId', async () => {
    const metrics = await service.findAllMetrics({}, platformAdminActor);
    expect(metrics).toHaveLength(1);
  });

  it('records metrics successfully', async () => {
    const dto = {
      messageId: 'msg-123',
      modelUsed: 'gpt-4o-mini',
      latencyTotalMs: 1200,
      tokensIn: 500,
      tokensOut: 150,
      cost: 0.002,
      chunksRetrieved: 10,
      chunksUsed: 3,
      citationsValid: 3,
      citationsInvalid: 0,
      insufficientEvidence: false,
      status: 'success',
    };
    const recorded = await service.recordMetric(dto);
    expect(recorded.messageId).toBe('msg-123');
    expect(recorded.status).toBe('success');
  });
});
