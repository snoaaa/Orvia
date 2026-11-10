import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import type { RagPerformanceService } from '../services/rag-performance.service.js';
import { RagPerformanceController } from './rag-performance.controller.js';

describe('RagPerformanceController (#89)', () => {
  let controller: RagPerformanceController;
  let mockRagService: any;

  const mockActor: AuthenticatedUser = {
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

  beforeEach(() => {
    mockRagService = {
      findAllMetrics: vi.fn(),
      recordMetric: vi.fn(),
    };
    controller = new RagPerformanceController(mockRagService as unknown as RagPerformanceService);
  });

  it('delegates getMetrics to ragService.findAllMetrics with query and actor', async () => {
    const query = { schoolId: 'school-a' };
    mockRagService.findAllMetrics.mockResolvedValueOnce([{ id: 'metric-1', status: 'success' }]);

    const result = await controller.getMetrics(query, mockActor);
    expect(mockRagService.findAllMetrics).toHaveBeenCalledWith(query, mockActor);
    expect(result).toHaveLength(1);
  });

  it('delegates createMetric to ragService.recordMetric', async () => {
    const dto = {
      messageId: 'msg-1',
      modelUsed: 'gpt-4o-mini',
      latencyTotalMs: 1000,
      tokensIn: 100,
      tokensOut: 50,
      cost: 0.001,
      chunksRetrieved: 5,
      chunksUsed: 2,
      citationsValid: 2,
      citationsInvalid: 0,
      insufficientEvidence: false,
      status: 'success',
    };
    mockRagService.recordMetric.mockResolvedValueOnce({ id: 'metric-1', ...dto });

    const result = await controller.createMetric(dto);
    expect(mockRagService.recordMetric).toHaveBeenCalledWith(dto);
    expect(result.id).toBe('metric-1');
  });
});
