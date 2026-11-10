import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { assertSchoolAccess, schoolIdFilter, schoolsWithPermission } from '../../auth/utils/school-scope.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import { STORAGE_SERVICE } from '../../storage/storage.constants.js';
import { StorageService } from '../../storage/storage.service.js';
import { buildDocumentStorageKey } from '../../storage/utils/storage-key.util.js';
import type { CreateDocumentDto, CreateSpaceDto, ListDocumentsQueryDto, ListSpacesQueryDto, UpdateDocumentDto, UploadDocumentDto } from '../dto/index.js';
import { DocumentEntity, PaginatedDocumentsEntity, PaginatedSpacesEntity, SpaceEntity, ValidatedFileEntity } from '../entities/index.js';
import type { UploadedFile } from '../interfaces/index.js';
import { DocumentMapper, SpaceMapper } from '../mappers/index.js';
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
    const where: Prisma.DocumentWhereInput = schoolId ? { space: { schoolId } } : {};

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
    if (!doc) {
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
    assertSchoolAccess(actor, 'documents:create', space.schoolId);
    const id = randomUUID();
    const data = DocumentMapper.fromDtoToCreateInput(dto, id);
    const created = await this.prisma.document.create({
      data,
    });
    return DocumentMapper.toEntity(created);
  }

  async updateDocument(id: string, dto: UpdateDocumentDto, actor: AuthenticatedUser): Promise<DocumentEntity> {
    await this.findDocumentInScope(id, actor, 'documents:update');
    const updated = await this.prisma.document.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.author !== undefined && { author: dto.author }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
      },
    });
    return DocumentMapper.toEntity(updated);
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
      assertSchoolAccess(actor, 'spaces:create', dto.schoolId);
    } else if (schoolsWithPermission(actor, 'spaces:create') !== 'all') {
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
    assertSchoolAccess(actor, 'documents:create', space.schoolId);

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
  ): Promise<DocumentEntity> {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
      select: { id: true, schoolId: true },
    });
    if (!space) {
      throw new NotFoundException(`Space with ID ${spaceId} not found`);
    }

    assertSchoolAccess(actor, 'documents:create', space.schoolId);

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

    if (validated.mimeType !== 'application/pdf') {
      throw new BadRequestException(
        `Only PDF documents are supported by this endpoint (detected: ${validated.mimeType}). For images, use the image upload endpoint.`,
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
      extension: 'pdf',
    });

    // 1. Save file to storage
    await this.storageService.save(storageKey, file.buffer);

    // 2. Perform DB transaction
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
            mimeType: 'application/pdf',
            checksum: validated.checksum,
            status: 'pending',
            pageCount: 0,
          },
        });

        await tx.processingJob.create({
          data: {
            id: jobId,
            versionId,
            step: 'ingestion',
            status: 'pending',
            durationMs: 0,
            ocrConfidence: 1.0,
            pageCount: 0,
            chunkCount: 0,
          },
        });

        return { createdDoc: doc, createdVersion: ver };
      });

      // 3. Dispatch background processing job
      this.processingQueueService.enqueueJob({
        jobId,
        versionId,
        documentId,
        spaceId,
        storageKey,
        mimeType: 'application/pdf',
      });

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
  ): Promise<DocumentEntity> {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
      select: { id: true, schoolId: true },
    });
    if (!space) {
      throw new NotFoundException(`Space with ID ${spaceId} not found`);
    }

    assertSchoolAccess(actor, 'documents:create', space.schoolId);

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

    const isImage =
      validated.mimeType === 'image/jpeg' ||
      validated.mimeType === 'image/png' ||
      validated.mimeType === 'image/heic' ||
      validated.mimeType === 'image/heif';

    if (!isImage) {
      throw new BadRequestException(
        `Only JPEG, PNG, and HEIC images are supported by this endpoint (detected: ${validated.mimeType}). For PDF documents, use the PDF upload endpoint.`,
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

      return DocumentMapper.toEntity(createdDoc, createdVersion);
    } catch (err) {
      // Clean up written file from storage if DB transaction failed
      await this.storageService.delete(storageKey).catch(() => {});
      throw err;
    }
  }
}
