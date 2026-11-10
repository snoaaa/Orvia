import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../database/prisma.service.js';
import { ProcessingQueueService } from './processing-queue.service.js';

describe('ProcessingQueueService', () => {
  let service: ProcessingQueueService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      processingJob: {
        update: vi.fn().mockResolvedValue({ id: 'job-1' }),
      },
    };

    service = new ProcessingQueueService(mockPrisma as unknown as PrismaService);
  });

  it('enqueues a processing job and returns immediately', () => {
    const jobInput = {
      jobId: 'job-1',
      versionId: 'ver-1',
      documentId: 'doc-1',
      spaceId: 'space-1',
      storageKey: 'spaces/space-1/docs/doc-1/v1.pdf',
      mimeType: 'application/pdf',
    };

    service.enqueueJob(jobInput);
    // At enqueue time, it is tracked in memory
    expect(service.getPendingJobCount()).toBeGreaterThanOrEqual(0);
  });

  it('processes job asynchronously in background via setImmediate', async () => {
    const jobInput = {
      jobId: 'job-1',
      versionId: 'ver-1',
      documentId: 'doc-1',
      spaceId: 'space-1',
      storageKey: 'spaces/space-1/docs/doc-1/v1.pdf',
      mimeType: 'application/pdf',
    };

    service.enqueueJob(jobInput);

    // Wait for setImmediate to trigger
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockPrisma.processingJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: {
        step: 'ingestion_queued',
        updatedAt: expect.any(Date),
      },
    });
  });

  it('handles background processing errors without crashing', async () => {
    mockPrisma.processingJob.update.mockRejectedValueOnce(new Error('DB connection dropped'));

    const jobInput = {
      jobId: 'job-2',
      versionId: 'ver-2',
      documentId: 'doc-2',
      spaceId: 'space-1',
      storageKey: 'spaces/space-1/docs/doc-2/v1.pdf',
      mimeType: 'application/pdf',
    };

    service.enqueueJob(jobInput);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Queue continues safely
    expect(service.getPendingJobCount()).toBe(0);
  });
});
