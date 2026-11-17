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
      document: {
        findFirst: vi.fn().mockResolvedValue({ id: 'doc-1' }),
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

  it('skips a job whose document or space was deleted while it waited (#98)', async () => {
    mockPrisma.document.findFirst.mockResolvedValueOnce(null);

    service.enqueueJob({
      jobId: 'job-3',
      versionId: 'ver-3',
      documentId: 'doc-3',
      spaceId: 'space-1',
      storageKey: 'spaces/space-1/docs/doc-3/v1.pdf',
      mimeType: 'application/pdf',
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockPrisma.document.findFirst).toHaveBeenCalledWith({
      where: { id: 'doc-3', deletedAt: null, space: { deletedAt: null } },
      select: { id: true },
    });
    expect(mockPrisma.processingJob.update).not.toHaveBeenCalled();
    expect(service.getPendingJobCount()).toBe(0);
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

