import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { DocumentVersionStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../database/prisma.service.js';
import { audienceOf, documentManagerIds } from '../utils/document-audience.util.js';
import { ALLOWED_STATUS_CHANGES, DocumentProcessingStatusService } from './document-processing-status.service.js';

vi.mock('../utils/document-audience.util.js', () => ({ audienceOf: vi.fn(), documentManagerIds: vi.fn() }));

describe('DocumentProcessingStatusService (#112)', () => {
  const prisma = {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    documentVersion: { findUniqueOrThrow: vi.fn(), update: vi.fn(), count: vi.fn() },
    processingJob: { findFirst: vi.fn(), update: vi.fn() },
    document: { findUnique: vi.fn() },
    syncChange: { createMany: vi.fn() },
  };
  const service = new DocumentProcessingStatusService(prisma as unknown as PrismaService);
  const jobStarted = new Date(Date.now() - 5000);
  const at = (status: DocumentVersionStatus) => prisma.$queryRaw.mockResolvedValue([{ status }]);

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.$transaction.mockImplementation((run: (tx: typeof prisma) => Promise<unknown>) => run(prisma));
    at('pending');
    prisma.documentVersion.findUniqueOrThrow.mockResolvedValue({ documentId: 'doc-1', statusError: null, statusChangedAt: new Date(0) });
    prisma.processingJob.findFirst.mockResolvedValue({ id: 'job-1', createdAt: new Date(0), startedAt: jobStarted });
    prisma.document.findUnique.mockResolvedValue({
      deletedAt: null,
      space: { schoolId: 'school-a' },
      access: [{ targetType: 'school', roleId: null, groupId: null, userId: null }],
    });
    prisma.documentVersion.count.mockResolvedValue(0);
    vi.mocked(audienceOf).mockResolvedValue(new Set(['reader-1', 'manager-1']));
    vi.mocked(documentManagerIds).mockResolvedValue(new Set(['manager-1']));
  });

  it('allows exactly the pipeline order', () => {
    expect(ALLOWED_STATUS_CHANGES).toEqual({
      pending: ['ocr', 'segmentation', 'error'],
      ocr: ['segmentation', 'error'],
      segmentation: ['indexing', 'error'],
      indexing: ['available', 'error'],
      available: [],
      error: ['pending'],
    });
  });

  it('stores the new status with its time, locks the version first, and marks the job in progress', async () => {
    const res = await service.setStatus('v1', 'ocr');
    expect(prisma.$queryRaw.mock.calls[0][0].join('?')).toContain('FOR UPDATE');
    const update = prisma.documentVersion.update.mock.calls[0][0];
    expect(update).toMatchObject({ where: { id: 'v1' }, data: { status: 'ocr', statusError: null } });
    expect(update.data.statusChangedAt).toBeInstanceOf(Date);
    expect(prisma.processingJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: 'in_progress', error: null, step: 'ocr' },
    });
    expect(res).toMatchObject({ versionId: 'v1', documentId: 'doc-1', from: 'pending', status: 'ocr', readersNotified: 0 });
  });

  it('stores the reason of a failure on the version and the job, with the duration', async () => {
    at('segmentation');
    await service.setStatus('v1', 'error', '  Page 3 is unreadable  ');
    expect(prisma.documentVersion.update.mock.calls[0][0].data).toMatchObject({ status: 'error', statusError: 'Page 3 is unreadable' });
    const job = prisma.processingJob.update.mock.calls[0][0].data;
    expect(job).toMatchObject({ status: 'failed', error: 'Page 3 is unreadable' });
    expect(job.durationMs).toBeGreaterThanOrEqual(5000);
    expect(job.durationMs).toBeLessThan(60_000); // from the start of this run, not from the job's creation
  });

  it('requires a reason for error, before touching anything', async () => {
    await expect(service.setStatus('v1', 'error', '  ')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('clears the reason when a failed version is processed again', async () => {
    at('error');
    await service.setStatus('v1', 'pending');
    expect(prisma.documentVersion.update.mock.calls[0][0].data).toMatchObject({ status: 'pending', statusError: null });
    const job = prisma.processingJob.update.mock.calls[0][0].data;
    expect(job).toMatchObject({ status: 'pending', error: null, durationMs: 0 });
    expect(job.startedAt).toBeInstanceOf(Date);
    expect(Date.now() - job.startedAt.getTime()).toBeLessThan(1000);
  });

  it.each([
    ['pending', 'indexing'],
    ['pending', 'available'],
    ['ocr', 'pending'],
    ['indexing', 'segmentation'],
    ['available', 'error'],
    ['available', 'pending'],
    ['error', 'available'],
    ['error', 'error'],
  ] as [DocumentVersionStatus, DocumentVersionStatus][])('refuses %s -> %s with 409', async (from, to) => {
    at(from);
    await expect(service.setStatus('v1', to, 'reason')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.documentVersion.update).not.toHaveBeenCalled();
  });

  it('does nothing when the status does not change (a retried step)', async () => {
    at('segmentation');
    const res = await service.setStatus('v1', 'segmentation');
    expect(prisma.documentVersion.update).not.toHaveBeenCalled();
    expect(res).toMatchObject({ from: 'segmentation', status: 'segmentation', statusChangedAt: new Date(0) });
  });

  it('answers 404 for an unknown version', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    await expect(service.setStatus('v9', 'ocr')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('works for a version without a processing job', async () => {
    prisma.processingJob.findFirst.mockResolvedValue(null);
    await service.setStatus('v1', 'segmentation');
    expect(prisma.processingJob.update).not.toHaveBeenCalled();
  });

  describe('the first available version', () => {
    beforeEach(() => at('indexing'));

    it('completes the job and announces the document to its readers, not to managers', async () => {
      const res = await service.setStatus('v1', 'available');
      expect(prisma.processingJob.update.mock.calls[0][0].data).toMatchObject({ status: 'completed', error: null });
      expect(audienceOf).toHaveBeenCalledWith(prisma, 'school-a', [expect.objectContaining({ targetType: 'school' })]);
      expect(prisma.syncChange.createMany).toHaveBeenCalledWith({
        data: [{ userId: 'reader-1', entityType: 'document', entityId: 'doc-1', operation: 'insert' }],
      });
      expect(res.readersNotified).toBe(1);
    });

    it('announces nothing when an earlier version was already available', async () => {
      prisma.documentVersion.count.mockResolvedValue(1);
      expect((await service.setStatus('v1', 'available')).readersNotified).toBe(0);
      expect(prisma.syncChange.createMany).not.toHaveBeenCalled();
    });

    it('announces nothing for a draft or a deleted document', async () => {
      prisma.document.findUnique.mockResolvedValueOnce({ deletedAt: null, space: { schoolId: 'school-a' }, access: [] });
      await service.setStatus('v1', 'available');
      prisma.document.findUnique.mockResolvedValueOnce({ deletedAt: new Date(), space: { schoolId: 'school-a', deletedAt: null }, access: [{ targetType: 'school' }] });
      await service.setStatus('v1', 'available');
      prisma.document.findUnique.mockResolvedValueOnce({ deletedAt: null, space: { schoolId: 'school-a', deletedAt: new Date() }, access: [{ targetType: 'school' }] });
      await service.setStatus('v1', 'available');
      expect(audienceOf).not.toHaveBeenCalled();
      expect(prisma.syncChange.createMany).not.toHaveBeenCalled();
    });
  });
});
