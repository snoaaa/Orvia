import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { assertSchoolAccess, canInSchool, schoolIdFilter, schoolsWithPermission } from '../../auth/utils/school-scope.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import { STORAGE_SERVICE } from '../../storage/storage.constants.js';
import { StorageService } from '../../storage/storage.service.js';
import { buildDocumentStorageKey } from '../../storage/utils/storage-key.util.js';
import type { CreateDocumentDto, CreateSpaceDto, ListDocumentsQueryDto, ListSpacesQueryDto, UpdateDocumentDto, UploadDocumentDto } from '../dto/index.js';
import {
  DocumentEntity,
  DocumentVersionItemEntity,
  DocumentVersionUploaderEntity,
  PaginatedDocumentsEntity,
  PaginatedSpacesEntity,
  SpaceEntity,
  ValidatedFileEntity,
} from '../entities/index.js';
import type { UploadedFile } from '../interfaces/index.js';
import { DocumentMapper, SpaceMapper } from '../mappers/index.js';
import { formatContentDispositionFilename, parseHttpRange } from '../utils/http-range.util.js';
import { determineInitialProcessingStep, isImageMimeType } from '../utils/magic-bytes.util.js';
import { AuditEvents } from '../../audit/builders/audit-events.builder.js';
import { AuditAction } from '../../audit/constants/audit-events.constants.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { type AuditRequestContext, SYSTEM_AUDIT_CONTEXT } from '../../audit/utils/audit-request-context.util.js';
import { FileValidationService } from './file-validation.service.js';
import { ImageConversionService } from './image-conversion.service.js';
import { ProcessingQueueService } from './processing-queue.service.js';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileValidationService: FileValidationService,
    @Inject(STORAGE_SERVICE) private readonly storageService: StorageService,
    private readonly processingQueueService: ProcessingQueueService,
    private readonly imageConversionService: ImageConversionService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Platform-wide readers see every document; others only the documents of spaces in their schools.
   * Paginated with the shared `page`/`limit` contract (`limit` capped at 100) and ordered
   * `created_at DESC, id DESC`, so pages stay stable when two documents share a timestamp.
   */
  async findAllDocuments(
    actor: AuthenticatedUser,
    query?: ListDocumentsQueryDto,
  ): Promise<PaginatedDocumentsEntity> {
    const page = Math.max(1, query?.page ?? 1);
    const limit = Math.min(100, Math.max(1, query?.limit ?? 10));
    const skip = (page - 1) * limit;

    const schoolId = schoolIdFilter(actor, 'documents:read');
    const where: Prisma.DocumentWhereInput = {
      deletedAt: null,
      ...(schoolId ? { space: { schoolId } } : {}),
    };

    const [total, docs] = await Promise.all([
      this.prisma.document.count({ where }),
      this.prisma.document.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return new PaginatedDocumentsEntity({
      data: docs.map((d) => DocumentMapper.toEntity(d)),
      total,
      page,
      limit,
      totalPages,
    });
  }

  async findDocumentById(id: string, actor: AuthenticatedUser): Promise<DocumentEntity> {
    return DocumentMapper.toEntity(await this.findDocumentInScope(id, actor, 'documents:read'));
  }

  /** Loads a document and throws 403 unless `actor` has `permission` in the school of its space. */
  private async findDocumentInScope(id: string, actor: AuthenticatedUser, permission: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      include: { space: { select: { schoolId: true } } },
    });
    if (!doc || doc.deletedAt) {
      throw new NotFoundException(`Document with ID ${id} not found`);
    }
    assertSchoolAccess(actor, permission, doc.space.schoolId);
    return doc;
  }

  async createDocument(dto: CreateDocumentDto, actor: AuthenticatedUser): Promise<DocumentEntity> {
    const space = await this.prisma.space.findUnique({ where: { id: dto.spaceId }, select: { schoolId: true } });
    if (!space) {
      throw new NotFoundException(`Space with ID ${dto.spaceId} not found`);
    }
    assertSchoolAccess(actor, 'documents:manage', space.schoolId);
    const id = randomUUID();
    const data = DocumentMapper.fromDtoToCreateInput(dto, id);
    const created = await this.prisma.document.create({
      data,
    });
    return DocumentMapper.toEntity(created);
  }

  /**
   * Updates metadata (title, author, date, tags) of an existing document (§4.1, #105).
   * Enforces school access, validates inputs, and records an immutable hash-chained audit event.
   */
  async updateDocument(
    id: string,
    dto: UpdateDocumentDto,
    actor: AuthenticatedUser,
    auditContext?: AuditRequestContext,
  ): Promise<DocumentEntity> {
    const doc = await this.findDocumentInScope(id, actor, 'documents:manage');

    if (dto.title !== undefined && dto.title.trim().length === 0) {
      throw new BadRequestException('Document title cannot be empty');
    }

    let parsedDate: Date | undefined;
    if (dto.date !== undefined) {
      parsedDate = new Date(dto.date);
      if (isNaN(parsedDate.getTime())) {
        throw new BadRequestException('Invalid date format for document date');
      }
    }

    const trimmedTitle = dto.title !== undefined ? dto.title.trim() : undefined;
    const trimmedAuthor = dto.author !== undefined ? dto.author.trim() : undefined;
    const trimmedTags = dto.tags !== undefined ? dto.tags.trim() : undefined;

    // Detect actual changes for the audit trail
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (trimmedTitle !== undefined && trimmedTitle !== doc.title) {
      changes.title = { from: doc.title, to: trimmedTitle };
    }
    if (trimmedAuthor !== undefined && trimmedAuthor !== doc.author) {
      changes.author = { from: doc.author, to: trimmedAuthor };
    }
    if (trimmedTags !== undefined && trimmedTags !== doc.tags) {
      changes.tags = { from: doc.tags, to: trimmedTags };
    }
    if (parsedDate !== undefined && parsedDate.toISOString() !== doc.createdAt.toISOString()) {
      changes.date = { from: doc.createdAt.toISOString(), to: parsedDate.toISOString() };
    }

    const [updated, currentVersion] = await Promise.all([
      this.prisma.document.update({
        where: { id },
        data: {
          ...(trimmedTitle !== undefined && { title: trimmedTitle }),
          ...(trimmedAuthor !== undefined && { author: trimmedAuthor }),
          ...(trimmedTags !== undefined && { tags: trimmedTags }),
          ...(parsedDate !== undefined && { createdAt: parsedDate }),
        },
      }),
      this.prisma.documentVersion.findFirst({
        where: { documentId: id },
        orderBy: { versionNo: 'desc' },
      }),
    ]);

    // Record audit event if any field changed
    if (Object.keys(changes).length > 0) {
      await this.audit.record(
        AuditEvents.documentUpdated(
          {
            documentId: id,
            spaceId: doc.spaceId,
            schoolId: doc.space.schoolId,
            actor: { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
            changes,
          },
          auditContext ?? SYSTEM_AUDIT_CONTEXT,
        ),
      );
    }

    return DocumentMapper.toEntity(updated, currentVersion);
  }

  /**
   * Soft-deletes a document (§4.1, §9, #108):
   * 1. Validates document exists, is not already deleted, and caller has `documents:delete` rights in the space school.
   * 2. Sets `deletedAt = new Date()`.
   * 3. Excludes its versions/chunks from retrieval: any download or stream attempts will throw 404.
   * 4. Past answers that cited this document will show the reference as unavailable (Issue #127).
   * 5. Records an immutable hash-chained audit event (`document_deleted`).
   */
  async deleteDocument(
    id: string,
    actor: AuthenticatedUser,
    auditContext?: AuditRequestContext,
  ): Promise<{ success: boolean; id: string; message: string }> {
    const doc = await this.findDocumentInScope(id, actor, 'documents:manage');

    const versionsCount = await this.prisma.documentVersion.count({
      where: { documentId: doc.id },
    });

    const deletedAt = new Date();
    await this.prisma.document.update({
      where: { id: doc.id },
      data: { deletedAt },
    });

    await this.audit.record(
      AuditEvents.documentDeleted(
        {
          documentId: doc.id,
          spaceId: doc.spaceId,
          schoolId: doc.space.schoolId,
          title: doc.title,
          versionsCount,
          actor: { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
        },
        auditContext ?? SYSTEM_AUDIT_CONTEXT,
      ),
    );

    return {
      success: true,
      id: doc.id,
      message: 'Document successfully soft-deleted',
    };
  }

  /**
   * Replaces an existing document with a new uploaded version (§4.1, §4.3, §5.2, #106):
   * 1. Verifies document exists, is not soft-deleted, and caller has `documents:update` rights in the space's school.
   * 2. Runs pre-ingestion validation (magic bytes, size, malware check, space duplicate check with allowDuplicates=true so content can update).
   * 3. Converts HEIC to JPEG if needed via `ImageConversionService`.
   * 4. Queries latest `versionNo` and increments by 1 (`v2`, `v3`, ...).
   * 5. Atomically saves file to storage via `StorageService`.
   * 6. Atomically creates new `DocumentVersion` (status: 'pending') and `ProcessingJob` in DB, updating document `updatedAt`.
   * 7. Enqueues background job to `ProcessingQueueService` for format-specific ingestion / chunking.
   * 8. Records immutable audit event `document_replaced`.
   * 9. Returns `DocumentEntity` with `currentVersion` pointing to the new version.
   * 10. Cleans up storage if DB transaction fails.
   */
  async replaceDocumentVersion(
    documentId: string,
    file: UploadedFile,
    actor: AuthenticatedUser,
    auditContext?: AuditRequestContext,
  ): Promise<DocumentEntity> {
    const doc = await this.findDocumentInScope(documentId, actor, 'documents:manage');

    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('A replacement file must be uploaded under the "file" field');
    }

    // Pre-ingestion validation (magic-bytes, size limit, antivirus scanning)
    // Note: allowDuplicates=true allows re-uploading an amended file without collision false-positives
    const validated = await this.fileValidationService.validateFile({
      buffer: file.buffer,
      originalName: file.originalname,
      declaredMimeType: file.mimetype,
      spaceId: doc.spaceId,
      allowDuplicates: true,
    });

    // Prepare buffer & extension (e.g. converts HEIC/HEIF to JPEG for OCR)
    const isImage = isImageMimeType(validated.mimeType);
    let finalBuffer = file.buffer;
    let finalMimeType = validated.mimeType;
    let finalExtension = validated.extension;

    if (validated.mimeType === 'image/heic' || validated.mimeType === 'image/heif') {
      const prepared = await this.imageConversionService.prepareImageForOcr(
        file.buffer,
        validated.mimeType,
      );
      finalBuffer = prepared.buffer;
      finalMimeType = prepared.mimeType;
      finalExtension = prepared.extension;
    }

    // Determine the next version number
    const latestVersion = await this.prisma.documentVersion.findFirst({
      where: { documentId },
      orderBy: { versionNo: 'desc' },
      select: { versionNo: true },
    });
    const nextVersionNo = (latestVersion?.versionNo ?? 0) + 1;

    const versionId = randomUUID();
    const jobId = randomUUID();
    const storageKey = buildDocumentStorageKey({
      spaceId: doc.spaceId,
      documentId,
      version: nextVersionNo,
      extension: finalExtension,
    });

    // 1. Save file to storage
    await this.storageService.save(storageKey, finalBuffer);

    // 2. Determine initial processing step
    const step = determineInitialProcessingStep(finalMimeType);

    // 3. Perform DB transaction
    try {
      const { updatedDoc, createdVersion } = await this.prisma.$transaction(async (tx) => {
        const ver = await tx.documentVersion.create({
          data: {
            id: versionId,
            documentId,
            versionNo: nextVersionNo,
            storageKey,
            mimeType: finalMimeType,
            checksum: validated.checksum,
            status: 'pending',
            pageCount: isImage ? 1 : 0,
          },
        });

        await tx.processingJob.create({
          data: {
            id: jobId,
            versionId,
            step,
            status: 'pending',
            durationMs: 0,
            ocrConfidence: 1.0,
            pageCount: isImage ? 1 : 0,
            chunkCount: 0,
          },
        });

        const docRecord = await tx.document.update({
          where: { id: documentId },
          data: {
            updatedAt: new Date(),
          },
        });

        return { updatedDoc: docRecord, createdVersion: ver };
      });

      // 4. Dispatch background processing job
      this.processingQueueService.enqueueJob({
        jobId,
        versionId,
        documentId,
        spaceId: doc.spaceId,
        storageKey,
        mimeType: finalMimeType,
        targetStep: step === 'ocr' ? 'ocr' : undefined,
      });

      // 5. Write audit entry
      await this.audit.record(
        AuditEvents.documentReplaced(
          {
            documentId,
            spaceId: doc.spaceId,
            schoolId: doc.space.schoolId,
            versionNo: nextVersionNo,
            versionId,
            checksum: validated.checksum,
            mimeType: finalMimeType,
            actor: { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
          },
          auditContext ?? SYSTEM_AUDIT_CONTEXT,
        ),
      );

      return DocumentMapper.toEntity(updatedDoc, createdVersion);
    } catch (err) {
      // Clean up written file from storage if DB transaction failed
      await this.storageService.delete(storageKey).catch(() => {});
      throw err;
    }
  }

  /**
   * Spaces of the caller's schools, paginated with the shared `page`/`limit` contract and ordered
   * alphabetically (stable id tie-breaker). The table is small, so no extra index is needed.
   */
  async findAllSpaces(actor: AuthenticatedUser, query?: ListSpacesQueryDto): Promise<PaginatedSpacesEntity> {
    const page = Math.max(1, query?.page ?? 1);
    const limit = Math.min(100, Math.max(1, query?.limit ?? 10));
    const skip = (page - 1) * limit;

    const schoolId = schoolIdFilter(actor, 'spaces:read');
    const where: Prisma.SpaceWhereInput = schoolId ? { schoolId } : {};

    const [total, spaces] = await Promise.all([
      this.prisma.space.count({ where }),
      this.prisma.space.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return new PaginatedSpacesEntity({
      data: spaces.map((s) => SpaceMapper.toEntity(s)),
      total,
      page,
      limit,
      totalPages,
    });
  }

  /** School-scoped users must create the space in one of their schools. */
  async createSpace(dto: CreateSpaceDto, actor: AuthenticatedUser): Promise<SpaceEntity> {
    if (dto.schoolId) {
      assertSchoolAccess(actor, 'documents:manage', dto.schoolId);
    } else if (schoolsWithPermission(actor, 'documents:manage') !== 'all') {
      throw new BadRequestException('schoolId is required: you can only create spaces in your own school');
    }
    const id = randomUUID();
    let schoolId = dto.schoolId;
    if (!schoolId) {
      const existingSchool = await this.prisma.school.findFirst();
      if (existingSchool) {
        schoolId = existingSchool.id;
      } else {
        const defaultSchool = await this.prisma.school.create({
          data: {
            id: randomUUID(),
            name: 'Default Institution',
            allowedDomains: '*',
          },
        });
        schoolId = defaultSchool.id;
      }
    }

    const data = SpaceMapper.fromDtoToCreateInput(dto, id, schoolId);
    const created = await this.prisma.space.create({
      data,
    });
    return SpaceMapper.toEntity(created);
  }

  /**
   * Validates an uploaded file prior to storage and ingestion (§5.2 Ingestion, #100).
   * Verifies school access to the space, checks MIME magic bytes, size limit,
   * runs malware scanning, and checks for duplicates within the target space.
   */
  async validateUploadedFile(
    spaceId: string,
    file: UploadedFile,
    actor: AuthenticatedUser,
  ): Promise<ValidatedFileEntity> {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
      select: { schoolId: true },
    });
    if (!space) {
      throw new NotFoundException(`Space with ID ${spaceId} not found`);
    }
    assertSchoolAccess(actor, 'documents:manage', space.schoolId);

    if (!file || !file.buffer) {
      throw new BadRequestException('A file must be uploaded under the "file" field');
    }

    const validated = await this.fileValidationService.validateFile({
      buffer: file.buffer,
      originalName: file.originalname,
      declaredMimeType: file.mimetype,
      spaceId,
    });

    return new ValidatedFileEntity({
      valid: true,
      checksum: validated.checksum,
      mimeType: validated.mimeType,
      extension: validated.extension,
      size: validated.size,
    });
  }

  /**
   * Uploads a PDF to a space (§4.1, §6 Scalabilité, §9, #102):
   * 1. Validates space exists and verifies caller has `documents:create` access to space's school.
   * 2. Runs pre-ingestion validation (size, magic bytes, antivirus, duplicates).
   * 3. Confirms verified MIME type is `application/pdf`.
   * 4. Atomically writes file to storage via `StorageService`.
   * 5. Atomically creates Document, DocumentVersion (v1, status: 'pending'), and ProcessingJob in DB.
   * 6. Enqueues background job to `ProcessingQueueService` asynchronously.
   * 7. Returns `DocumentEntity` with `currentVersion`.
   */
  async uploadPdf(
    spaceId: string,
    file: UploadedFile,
    dto: UploadDocumentDto,
    actor: AuthenticatedUser,
    auditContext?: AuditRequestContext,
  ): Promise<DocumentEntity> {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
      select: { id: true, schoolId: true },
    });
    if (!space) {
      throw new NotFoundException(`Space with ID ${spaceId} not found`);
    }

    assertSchoolAccess(actor, 'documents:manage', space.schoolId);

    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('A PDF file must be uploaded under the "file" field');
    }

    // Run pre-ingestion validation (size, magic bytes, antivirus, duplicates)
    const validated = await this.fileValidationService.validateFile({
      buffer: file.buffer,
      originalName: file.originalname,
      declaredMimeType: file.mimetype,
      spaceId,
    });

    if (isImageMimeType(validated.mimeType)) {
      throw new BadRequestException(
        'Images should be uploaded via the dedicated image upload endpoint (POST /documents/spaces/:spaceId/upload-image) for OCR processing.',
      );
    }

    const documentId = randomUUID();
    const versionId = randomUUID();
    const jobId = randomUUID();
    const versionNo = 1;
    const storageKey = buildDocumentStorageKey({
      spaceId,
      documentId,
      version: versionNo,
      extension: validated.extension,
    });

    // 1. Save file to storage
    await this.storageService.save(storageKey, file.buffer);

    // 2. Determine initial processing step based on document format (§4.1, §9, #150)
    const step = determineInitialProcessingStep(validated.mimeType);

    // 3. Perform DB transaction
    try {
      const defaultTitle = file.originalname
        ? file.originalname.replace(/\.[^/.]+$/, '').trim()
        : 'Untitled Document';
      const title = dto?.title?.trim() || defaultTitle || 'Untitled Document';
      const author = dto?.author?.trim() || actor.fullName || '';
      const tags = dto?.tags?.trim() || '';

      const { createdDoc, createdVersion } = await this.prisma.$transaction(async (tx) => {
        const doc = await tx.document.create({
          data: {
            id: documentId,
            spaceId,
            title,
            author,
            tags,
          },
        });

        const ver = await tx.documentVersion.create({
          data: {
            id: versionId,
            documentId,
            versionNo,
            storageKey,
            mimeType: validated.mimeType,
            checksum: validated.checksum,
            status: 'pending',
            pageCount: 0,
          },
        });

        await tx.processingJob.create({
          data: {
            id: jobId,
            versionId,
            step,
            status: 'pending',
            durationMs: 0,
            ocrConfidence: 1.0,
            pageCount: 0,
            chunkCount: 0,
          },
        });

        return { createdDoc: doc, createdVersion: ver };
      });

      // 4. Dispatch background processing job
      this.processingQueueService.enqueueJob({
        jobId,
        versionId,
        documentId,
        spaceId,
        storageKey,
        mimeType: validated.mimeType,
      });

      // 5. Record tamper-evident audit event (§4.5, #107)
      await this.audit.record(
        AuditEvents.documentUploaded(
          {
            documentId,
            spaceId,
            schoolId: space.schoolId,
            versionNo,
            versionId,
            checksum: validated.checksum,
            mimeType: validated.mimeType,
            actor: { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
          },
          auditContext ?? SYSTEM_AUDIT_CONTEXT,
        ),
      );

      return DocumentMapper.toEntity(createdDoc, createdVersion);
    } catch (err) {
      // Clean up written file from storage if DB transaction failed
      await this.storageService.delete(storageKey).catch(() => {});
      throw err;
    }
  }

  /**
   * Uploads an image (JPEG, PNG, HEIC) to a space (§4.1, §9, #103):
   * 1. Validates space exists and verifies caller has `documents:create` access to space's school.
   * 2. Runs pre-ingestion validation (size, magic bytes, antivirus, duplicates).
   * 3. Confirms verified MIME type is an allowed image format (`image/jpeg`, `image/png`, `image/heic`, `image/heif`).
   * 4. Converts HEIC to JPEG if needed via `ImageConversionService` so downstream OCR can decode it directly.
   * 5. Atomically writes file to storage via `StorageService`.
   * 6. Atomically creates Document, DocumentVersion (v1, status: 'pending', pageCount: 1), and ProcessingJob (step: 'ocr', status: 'pending') in DB.
   * 7. Enqueues background job to `ProcessingQueueService` for OCR asynchronously.
   * 8. Returns `DocumentEntity` with `currentVersion`.
   */
  async uploadImage(
    spaceId: string,
    file: UploadedFile,
    dto: UploadDocumentDto,
    actor: AuthenticatedUser,
    auditContext?: AuditRequestContext,
  ): Promise<DocumentEntity> {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
      select: { id: true, schoolId: true },
    });
    if (!space) {
      throw new NotFoundException(`Space with ID ${spaceId} not found`);
    }

    assertSchoolAccess(actor, 'documents:manage', space.schoolId);

    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('An image file must be uploaded under the "file" field');
    }

    // Run pre-ingestion validation (size, magic bytes, antivirus, duplicates)
    const validated = await this.fileValidationService.validateFile({
      buffer: file.buffer,
      originalName: file.originalname,
      declaredMimeType: file.mimetype,
      spaceId,
    });

    if (!isImageMimeType(validated.mimeType)) {
      throw new BadRequestException(
        `Only JPEG, PNG, and HEIC images are supported by this endpoint (detected: ${validated.mimeType}). For PDF and office documents, use the document upload endpoint.`,
      );
    }

    // Convert HEIC to JPEG if necessary for OCR processing
    const prepared = await this.imageConversionService.prepareImageForOcr(
      file.buffer,
      validated.mimeType,
    );

    const documentId = randomUUID();
    const versionId = randomUUID();
    const jobId = randomUUID();
    const versionNo = 1;
    const storageKey = buildDocumentStorageKey({
      spaceId,
      documentId,
      version: versionNo,
      extension: prepared.extension,
    });

    // 1. Save file to storage
    await this.storageService.save(storageKey, prepared.buffer);

    // 2. Perform DB transaction
    try {
      const defaultTitle = file.originalname
        ? file.originalname.replace(/\.[^/.]+$/, '').trim()
        : 'Untitled Image';
      const title = dto?.title?.trim() || defaultTitle || 'Untitled Image';
      const author = dto?.author?.trim() || actor.fullName || '';
      const tags = dto?.tags?.trim() || '';

      const { createdDoc, createdVersion } = await this.prisma.$transaction(async (tx) => {
        const doc = await tx.document.create({
          data: {
            id: documentId,
            spaceId,
            title,
            author,
            tags,
          },
        });

        const ver = await tx.documentVersion.create({
          data: {
            id: versionId,
            documentId,
            versionNo,
            storageKey,
            mimeType: prepared.mimeType,
            checksum: validated.checksum,
            status: 'pending',
            pageCount: 1, // Single-page image
          },
        });

        await tx.processingJob.create({
          data: {
            id: jobId,
            versionId,
            step: 'ocr',
            status: 'pending',
            durationMs: 0,
            ocrConfidence: 1.0,
            pageCount: 1,
            chunkCount: 0,
          },
        });

        return { createdDoc: doc, createdVersion: ver };
      });

      // 3. Dispatch background processing job targeting OCR
      this.processingQueueService.enqueueJob({
        jobId,
        versionId,
        documentId,
        spaceId,
        storageKey,
        mimeType: prepared.mimeType,
        targetStep: 'ocr',
      });

      // 4. Record tamper-evident audit event (§4.5, #107)
      await this.audit.record(
        AuditEvents.documentUploaded(
          {
            documentId,
            spaceId,
            schoolId: space.schoolId,
            versionNo,
            versionId,
            checksum: validated.checksum,
            mimeType: prepared.mimeType,
            actor: { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
          },
          auditContext ?? SYSTEM_AUDIT_CONTEXT,
        ),
      );

      return DocumentMapper.toEntity(createdDoc, createdVersion);
    } catch (err) {
      // Clean up written file from storage if DB transaction failed
      await this.storageService.delete(storageKey).catch(() => {});
      throw err;
    }
  }

  /**
   * Asserts whether the caller is authorized to download or stream a document version (§4.3, §7, #104).
   *
   * Authorization matrix:
   * 1. Platform admin (web): can download any version of any document across the platform.
   * 2. School admin / Document manager (web + mobile): can download any version of documents
   *    in the school(s) where they hold `documents:read` rights.
   * 3. Staff / Student / Parent / Guest:
   *    a) Can download ANY version cited in an answer generated for them (conversation references).
   *    b) Can download the CURRENT version if the document is published to them (matches school,
   *       role, or group publication rules, or open to school when no rules are configured).
   *    c) Cannot download un-cited past versions (returns 403).
   *    d) Cannot download documents out of their school/group scope (returns 403).
   */
  async assertCanDownloadDocumentVersion(
    actor: AuthenticatedUser,
    document: {
      id: string;
      spaceId: string;
      space: { schoolId: string };
      access: { schoolId: string | null; roleId: string | null; groupId: string | null }[];
    },
    version: {
      id: string;
      versionNo: number;
    },
  ): Promise<void> {
    // 1. Platform admin: global access
    if (actor.isPlatformAdmin || actor.assignments.some((a) => a.scope === 'platform')) {
      return;
    }

    // 2. Document managers with `documents:read` permission in this school
    if (canInSchool(actor, 'documents:read', document.space.schoolId)) {
      return;
    }

    // 3. User must at least belong to the school of this space
    if (!actor.schoolIds.includes(document.space.schoolId)) {
      throw new ForbiddenException('You do not have access to documents in this school');
    }

    // 4. Citation check: if this specific version is cited in an answer generated for this user
    const citation = await this.prisma.messageReference.findFirst({
      where: {
        documentVersionId: version.id,
        message: {
          conversation: {
            userId: actor.id,
          },
        },
      },
      select: { id: true },
    });

    if (citation) {
      return;
    }

    // 5. If not cited in user's own answers, only the CURRENT version can be downloaded
    const latestVersion = await this.prisma.documentVersion.findFirst({
      where: { documentId: document.id },
      orderBy: { versionNo: 'desc' },
      select: { id: true },
    });

    if (latestVersion?.id !== version.id) {
      throw new ForbiddenException(
        'Historical document versions can only be accessed by document managers or when cited in your conversations',
      );
    }

    // 6. Publication rules check: if specific access rules exist, user must match at least one
    if (document.access && document.access.length > 0) {
      const userAssignments = actor.assignments.filter(
        (a) => a.schoolId === document.space.schoolId,
      );
      const userRoles = new Set(userAssignments.map((a) => a.role));
      const userGroupIds = new Set(
        userAssignments.map((a) => a.groupId).filter((g): g is string => !!g),
      );

      const matches = document.access.some((rule) => {
        // School-level rule
        if (rule.schoolId && rule.schoolId === document.space.schoolId && !rule.roleId && !rule.groupId) {
          return true;
        }
        // Role-level rule
        if (rule.roleId && userRoles.has(rule.roleId)) {
          return true;
        }
        // Group-level rule
        if (rule.groupId && userGroupIds.has(rule.groupId)) {
          return true;
        }
        return false;
      });

      if (!matches) {
        throw new ForbiddenException('This document is not published to your school, role, or group');
      }
    }
  }

  /**
   * Streams a document version with HTTP range request support (§4.3, §7, #104).
   *
   * @param options.documentId Document UUID
   * @param options.versionRef Version number (integer string), version UUID, or 'latest'
   * @param options.actor Authenticated user requesting the file
   * @param options.rangeHeader Optional HTTP `Range` header (e.g. `bytes=0-1023`)
   * @param options.disposition 'attachment' for download prompt or 'inline' for viewer streaming
   */
  async getDocumentVersionStream(options: {
    documentId: string;
    versionRef?: string;
    actor: AuthenticatedUser;
    rangeHeader?: string;
    disposition?: 'attachment' | 'inline';
  }): Promise<{
    stream: Readable;
    statusCode: number;
    headers: Record<string, string | number>;
    filename: string;
    mimeType: string;
  }> {
    const { documentId, versionRef, actor, rangeHeader, disposition = 'attachment' } = options;

    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        space: { select: { id: true, schoolId: true, privacy: true } },
        access: { select: { schoolId: true, roleId: true, groupId: true } },
      },
    });

    if (!document || document.deletedAt) {
      throw new NotFoundException(`Document with ID ${documentId} not found`);
    }

    // Resolve target version
    let version;
    if (!versionRef || versionRef === 'latest') {
      version = await this.prisma.documentVersion.findFirst({
        where: { documentId },
        orderBy: { versionNo: 'desc' },
      });
    } else if (/^\d+$/.test(versionRef.trim())) {
      const versionNo = parseInt(versionRef.trim(), 10);
      version = await this.prisma.documentVersion.findFirst({
        where: { documentId, versionNo },
      });
    } else {
      version = await this.prisma.documentVersion.findFirst({
        where: { documentId, id: versionRef.trim() },
      });
    }

    if (!version) {
      throw new NotFoundException(
        `Version ${versionRef ?? 'latest'} not found for document with ID ${documentId}`,
      );
    }

    // Enforce role-based access control
    await this.assertCanDownloadDocumentVersion(actor, document, version);

    // Retrieve storage file metadata
    const metadata = await this.storageService.getMetadata(version.storageKey);
    const totalSize = metadata.size;

    // Parse byte range (RFC 7233)
    const range = parseHttpRange(rangeHeader, totalSize);

    // Open read stream for requested byte segment
    const stream = await this.storageService.read(version.storageKey, {
      start: range.start,
      end: range.end,
    });

    const ext = path.extname(version.storageKey) || '';
    const cleanTitle = document.title.trim() || 'document';
    const filename = cleanTitle.toLowerCase().endsWith(ext.toLowerCase())
      ? cleanTitle
      : `${cleanTitle}${ext}`;

    const { ascii, utf8 } = formatContentDispositionFilename(filename);

    const headers: Record<string, string | number> = {
      'Content-Type': version.mimeType,
      'Content-Length': range.chunkSize,
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `${disposition}; filename="${ascii}"; filename*=UTF-8''${utf8}`,
      'ETag': `"${version.checksum}"`,
      'Last-Modified': version.updatedAt.toUTCString(),
      'Cache-Control': 'private, max-age=3600',
    };

    if (range.isRange && range.contentRange) {
      headers['Content-Range'] = range.contentRange;
    }

    return {
      stream,
      statusCode: range.statusCode,
      headers,
      filename,
      mimeType: version.mimeType,
    };
  }

  /**
   * Lists the version history of a document (§4.5, #107):
   * 1. Verifies document exists and caller has `documents:update` rights in the space school.
   *    (Platform admins, school admins, and staff with document rights; mobile users cannot call this).
   * 2. Returns versions ordered newest first (`versionNo: 'desc'`).
   * 3. Enriches each version with size (from storage metadata) and uploader details (from audit trail).
   */
  async listDocumentVersions(
    documentId: string,
    actor: AuthenticatedUser,
  ): Promise<DocumentVersionItemEntity[]> {
    const doc = await this.findDocumentInScope(documentId, actor, 'documents:manage');

    const versions = await this.prisma.documentVersion.findMany({
      where: { documentId: doc.id },
      orderBy: { versionNo: 'desc' },
    });

    if (versions.length === 0) {
      return [];
    }

    const latestVersionNo = versions[0].versionNo;

    // Resolve file sizes from storage in parallel
    const sizes = await Promise.all(
      versions.map(async (v) => {
        try {
          const meta = await this.storageService.getMetadata(v.storageKey);
          return meta.size ?? 0;
        } catch {
          return 0;
        }
      }),
    );

    // Look up uploaders from the append-only audit trail
    const auditEvents = await this.prisma.auditEvent.findMany({
      where: {
        entityType: 'document',
        entityId: doc.id,
        action: {
          in: [
            AuditAction.DOCUMENT_UPLOADED,
            AuditAction.DOCUMENT_REPLACED,
            'document_uploaded',
            'document_replaced',
            'document_created',
          ],
        },
      },
      select: {
        actorId: true,
        details: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const versionUploaderMap = new Map<string, string>();
    for (const event of auditEvents) {
      if (!event.actorId) continue;
      const details = event.details as Record<string, unknown> | null;
      if (details) {
        if (typeof details.versionId === 'string' && !versionUploaderMap.has(details.versionId)) {
          versionUploaderMap.set(details.versionId, event.actorId);
        }
        if (typeof details.versionNo === 'number') {
          const key = `no_${details.versionNo}`;
          if (!versionUploaderMap.has(key)) {
            versionUploaderMap.set(key, event.actorId);
          }
        }
      }
    }

    const actorIds = Array.from(new Set(Array.from(versionUploaderMap.values())));
    const userMap = new Map<string, DocumentVersionUploaderEntity>();

    if (actorIds.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true, email: true },
      });
      for (const u of users) {
        userMap.set(
          u.id,
          new DocumentVersionUploaderEntity({
            id: u.id,
            name: u.name,
            email: u.email,
          }),
        );
      }
    }

    return versions.map((v, index) => {
      const actorId =
        versionUploaderMap.get(v.id) ?? versionUploaderMap.get(`no_${v.versionNo}`);
      const uploader = actorId
        ? (userMap.get(actorId) ??
          new DocumentVersionUploaderEntity({
            id: actorId,
            name: 'System User',
            email: '',
          }))
        : null;

      return new DocumentVersionItemEntity({
        id: v.id,
        documentId: v.documentId,
        versionNumber: v.versionNo,
        versionNo: v.versionNo,
        date: v.createdAt,
        createdAt: v.createdAt,
        uploader,
        size: sizes[index],
        checksum: v.checksum,
        status: v.status,
        mimeType: v.mimeType,
        storageKey: v.storageKey,
        pageCount: v.pageCount,
        isCurrent: v.versionNo === latestVersionNo,
      });
    });
  }
}
