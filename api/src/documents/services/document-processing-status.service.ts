import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { DocumentVersionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { audienceOf, documentManagerIds } from '../utils/document-audience.util.js';
import { DOCUMENT_SYNC } from './document-access.service.js';

/**
 * The statuses a version may move to from each status (#112):
 * pending → ocr (images and scanned files only) → segmentation → indexing → available,
 * error from any step before available, and error → pending to process the version again.
 * 'available' is final: a new file is a new version.
 */
export const ALLOWED_STATUS_CHANGES: Record<DocumentVersionStatus, readonly DocumentVersionStatus[]> = {
  pending: ['ocr', 'segmentation', 'error'],
  ocr: ['segmentation', 'error'],
  segmentation: ['indexing', 'error'],
  indexing: ['available', 'error'],
  available: [],
  error: ['pending'],
};

/** Processing job status matching each version status. */
const JOB_STATUS: Record<DocumentVersionStatus, string> = {
  pending: 'pending',
  ocr: 'in_progress',
  segmentation: 'in_progress',
  indexing: 'in_progress',
  available: 'completed',
  error: 'failed',
};

const STEPS: readonly DocumentVersionStatus[] = ['ocr', 'segmentation', 'indexing'];

/** Longest failure reason kept (the column is TEXT; reasons come from processing code). */
const MAX_REASON_LENGTH = 2000;

export interface StatusChangeResult {
  versionId: string;
  documentId: string;
  from: DocumentVersionStatus;
  status: DocumentVersionStatus;
  statusError: string | null;
  statusChangedAt: Date;
  /** Readers told by a sync change that the document appeared (its first available version). */
  readersNotified: number;
}

/**
 * The only way to change the processing status of a document version (#112). Called by the processing
 * pipeline at each step (and by the dev-only simulation route until the pipeline exists).
 * Each change is checked against the pipeline order, stored with its time, mirrored on the version's latest
 * processing job, and, when a document gets its first available version, announced to its readers' phones.
 */
@Injectable()
export class DocumentProcessingStatusService {
  private readonly logger = new Logger(DocumentProcessingStatusService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Moves `versionId` to `status`. `reason` is required for 'error' and ignored otherwise.
   * Setting the status the version already has does nothing (a retried step is harmless).
   * @throws NotFoundException unknown version; BadRequestException 'error' without a reason;
   *   ConflictException a change the pipeline order does not allow.
   */
  async setStatus(versionId: string, status: DocumentVersionStatus, reason?: string): Promise<StatusChangeResult> {
    const cleanReason = reason?.trim().slice(0, MAX_REASON_LENGTH);
    if (status === 'error' && !cleanReason) {
      throw new BadRequestException("A reason is required when a version's processing fails");
    }

    return this.prisma.$transaction(async (tx) => {
      // Lock the version: two workers reporting at the same time are applied one after the other.
      const rows = await tx.$queryRaw<{ status: DocumentVersionStatus }[]>`
        SELECT status FROM document_versions WHERE id = ${versionId} FOR UPDATE`;
      if (rows.length === 0) throw new NotFoundException(`Document version ${versionId} not found`);
      const from = rows[0].status;

      const version = await tx.documentVersion.findUniqueOrThrow({
        where: { id: versionId },
        select: { documentId: true, statusError: true, statusChangedAt: true },
      });
      const unchanged = { versionId, documentId: version.documentId, from, readersNotified: 0 };
      if (from === status && status !== 'error') {
        return { ...unchanged, status, statusError: version.statusError, statusChangedAt: version.statusChangedAt };
      }
      if (!ALLOWED_STATUS_CHANGES[from].includes(status)) {
        throw new ConflictException(`A version cannot go from '${from}' to '${status}'`);
      }

      const now = new Date();
      const statusError = status === 'error' ? cleanReason! : null;
      await tx.documentVersion.update({
        where: { id: versionId },
        data: { status, statusError, statusChangedAt: now },
      });
      await this.updateJob(tx, versionId, status, statusError, now);
      const readersNotified = status === 'available' ? await this.announceFirstAvailable(tx, version.documentId, versionId) : 0;

      this.logger.log(`Version ${versionId}: ${from} -> ${status}${statusError ? ` (${statusError})` : ''}`);
      return { ...unchanged, status, statusError, statusChangedAt: now, readersNotified };
    });
  }

  /** Mirrors the change on the latest processing job of the version, if any. */
  private async updateJob(
    tx: Prisma.TransactionClient,
    versionId: string,
    status: DocumentVersionStatus,
    error: string | null,
    now: Date,
  ): Promise<void> {
    const job = await tx.processingJob.findFirst({ where: { versionId }, orderBy: { createdAt: 'desc' } });
    if (!job) return;
    const finished = status === 'available' || status === 'error';
    // Processing again (error -> pending) is a new run: its duration counts from now, not from the first run.
    const restarted = status === 'pending';
    await tx.processingJob.update({
      where: { id: job.id },
      data: {
        status: JOB_STATUS[status],
        error,
        ...(STEPS.includes(status) ? { step: status } : {}),
        ...(restarted ? { startedAt: now, durationMs: 0 } : {}),
        ...(finished ? { durationMs: Math.max(0, now.getTime() - job.startedAt.getTime()) } : {}),
      },
    });
  }

  /**
   * Readers only see a document once a version is available (#111). When this is its first available
   * version, the readers its rules reach get an 'insert' sync change, like a new publication (#110).
   */
  private async announceFirstAvailable(tx: Prisma.TransactionClient, documentId: string, versionId: string): Promise<number> {
    const doc = await tx.document.findUnique({
      where: { id: documentId },
      select: {
        deletedAt: true,
        space: { select: { schoolId: true } },
        access: { select: { targetType: true, roleId: true, groupId: true, userId: true } },
      },
    });
    if (!doc || doc.deletedAt || doc.access.length === 0) return 0;
    const earlier = await tx.documentVersion.count({ where: { documentId, status: 'available', id: { not: versionId } } });
    if (earlier > 0) return 0;

    const schoolId = doc.space.schoolId;
    const readers = await audienceOf(tx, schoolId, doc.access);
    const managers = await documentManagerIds(tx, schoolId, [...readers]);
    const userIds = [...readers].filter((id) => !managers.has(id));
    if (userIds.length > 0) {
      await tx.syncChange.createMany({
        data: userIds.map((userId) => ({
          userId,
          entityType: DOCUMENT_SYNC.entityType,
          entityId: documentId,
          operation: DOCUMENT_SYNC.gained,
        })),
      });
    }
    return userIds.length;
  }
}
