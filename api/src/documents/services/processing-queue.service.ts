import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

export interface EnqueueProcessingJobInput {
  jobId: string;
  versionId: string;
  documentId: string;
  spaceId: string;
  storageKey: string;
  mimeType: string;
  targetStep?: 'ingestion' | 'ocr';
}

@Injectable()
export class ProcessingQueueService {
  private readonly logger = new Logger(ProcessingQueueService.name);
  private readonly pendingJobs: EnqueueProcessingJobInput[] = [];

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Pushes a processing job to the asynchronous ingestion queue (§6 Scalabilité, §9 Processing).
   * Returns immediately without blocking the HTTP upload response.
   */
  enqueueJob(job: EnqueueProcessingJobInput): void {
    this.pendingJobs.push(job);
    this.logger.log(
      `Enqueued processing job ${job.jobId} for document ${job.documentId} (version: ${job.versionId}, storage: ${job.storageKey})`,
    );

    // Dispatch processing in background asynchronously so API returns immediately
    setImmediate(() => {
      this.processNext(job).catch((err) => {
        this.logger.error(
          `Background processing error for job ${job.jobId} (version ${job.versionId}): ${err.message}`,
          err.stack,
        );
      });
    });
  }

  /**
   * Number of pending jobs in memory queue.
   */
  getPendingJobCount(): number {
    return this.pendingJobs.length;
  }

  /**
   * Background processor hook: updates step or invokes pipeline worker (§9).
   */
  private async processNext(job: EnqueueProcessingJobInput): Promise<void> {
    try {
      const nextStep = job.targetStep === 'ocr' ? 'ocr_queued' : 'ingestion_queued';
      // Transition processing job state to mark step received
      await this.prisma.processingJob.update({
        where: { id: job.jobId },
        data: {
          step: nextStep,
          updatedAt: new Date(),
        },
      });

      this.logger.log(`Background worker dispatched ${nextStep} for job ${job.jobId}`);
    } catch (err: any) {
      this.logger.warn(`Could not update processing job ${job.jobId}: ${err?.message}`);
    } finally {
      const idx = this.pendingJobs.findIndex((j) => j.jobId === job.jobId);
      if (idx !== -1) {
        this.pendingJobs.splice(idx, 1);
      }
    }
  }
}

