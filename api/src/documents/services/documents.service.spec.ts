import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { StorageService } from '../../storage/storage.service.js';
import type { UploadedFile } from '../interfaces/index.js';
import { DocumentsService } from './documents.service.js';
import type { FileValidationService } from './file-validation.service.js';
import type { ImageConversionService } from './image-conversion.service.js';
import type { ProcessingQueueService } from './processing-queue.service.js';

describe('DocumentsService', () => {
  let service: DocumentsService;
  let mockPrisma: any;
  let mockFileValidationService: any;
  let mockStorageService: any;
  let mockProcessingQueueService: any;
  let mockImageConversionService: any;

  const platformAdmin: AuthenticatedUser = {
    id: 'user-platform-admin',
    email: 'admin@orvia.internal',
    fullName: 'Platform Admin',
    status: 'ACTIVE',
    assignments: [
      {
        role: 'platform_admin',
        scope: 'platform',
        schoolId: '',
        groupId: null,
        permissions: ['*'],
      },
    ],
    permissions: ['*'],
    schoolIds: [],
    isPlatformAdmin: true,
    role: 'platform_admin',
    schoolId: null,
    sessionId: 'session-1',
  };

  const schoolAdmin: AuthenticatedUser = {
    id: 'user-school-admin',
    email: 'schooladmin@school1.edu',
    fullName: 'School Admin',
    status: 'ACTIVE',
    assignments: [
      {
        role: 'school_admin',
        scope: 'school',
        schoolId: 'school-1',
        groupId: null,
        permissions: ['documents:create', 'documents:read', 'documents:update', 'spaces:read', 'spaces:create'],
      },
    ],
    permissions: ['documents:create', 'documents:read', 'documents:update', 'spaces:read', 'spaces:create'],
    schoolIds: ['school-1'],
    isPlatformAdmin: false,
    role: 'school_admin',
    schoolId: 'school-1',
    sessionId: 'session-2',
  };

  beforeEach(() => {
    mockPrisma = {
      space: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        count: vi.fn(),
      },
      document: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      documentVersion: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      processingJob: {
        create: vi.fn(),
      },
      $transaction: vi.fn().mockImplementation(async (cb) => cb(mockPrisma)),
    };

    mockFileValidationService = {
      validateFile: vi.fn(),
    };

    mockStorageService = {
      save: vi.fn().mockResolvedValue({ key: 'test', size: 100 }),
      delete: vi.fn().mockResolvedValue(true),
    };

    mockProcessingQueueService = {
      enqueueJob: vi.fn(),
    };

    mockImageConversionService = {
      prepareImageForOcr: vi.fn().mockImplementation(async (buf, mime) => {
        if (mime === 'image/heic' || mime === 'image/heif') {
          return {
            buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
            mimeType: 'image/jpeg',
            extension: 'jpg',
            wasConverted: true,
          };
        }
        return {
          buffer: buf,
          mimeType: mime,
          extension: mime === 'image/png' ? 'png' : 'jpg',
          wasConverted: false,
        };
      }),
    };

    service = new DocumentsService(
      mockPrisma as unknown as PrismaService,
      mockFileValidationService as unknown as FileValidationService,
      mockStorageService as unknown as StorageService,
      mockProcessingQueueService as unknown as ProcessingQueueService,
      mockImageConversionService as unknown as ImageConversionService,
    );
  });

  describe('validateUploadedFile', () => {
    it('throws NotFoundException when space does not exist', async () => {
      mockPrisma.space.findUnique.mockResolvedValueOnce(null);

      const mockFile = {
        buffer: Buffer.from('%PDF-1.4\nTest PDF'),
        originalname: 'test.pdf',
        mimetype: 'application/pdf',
      } as UploadedFile;

      await expect(
        service.validateUploadedFile('non-existent-space', mockFile, platformAdmin),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException if user lacks documents:create permission in space school', async () => {
      mockPrisma.space.findUnique.mockResolvedValueOnce({
        id: 'space-school-2',
        schoolId: 'school-2', // Different school from schoolAdmin's school-1
      });

      const mockFile = {
        buffer: Buffer.from('%PDF-1.4\nTest PDF'),
        originalname: 'test.pdf',
        mimetype: 'application/pdf',
      } as UploadedFile;

      await expect(
        service.validateUploadedFile('space-school-2', mockFile, schoolAdmin),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException if no file or empty buffer provided', async () => {
      mockPrisma.space.findUnique.mockResolvedValueOnce({
        id: 'space-1',
        schoolId: 'school-1',
      });

      await expect(
        service.validateUploadedFile('space-1', null as unknown as Express.Multer.File, schoolAdmin),
      ).rejects.toThrow(BadRequestException);
    });

    it('successfully validates an uploaded file and returns ValidatedFileEntity', async () => {
      mockPrisma.space.findUnique.mockResolvedValueOnce({
        id: 'space-1',
        schoolId: 'school-1',
      });

      mockFileValidationService.validateFile.mockResolvedValueOnce({
        checksum: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        mimeType: 'application/pdf',
        extension: 'pdf',
        size: 1024,
      });

      const mockFile = {
        buffer: Buffer.from('%PDF-1.4\nTest content'),
        originalname: 'syllabus.pdf',
        mimetype: 'application/pdf',
      } as UploadedFile;

      const result = await service.validateUploadedFile('space-1', mockFile, schoolAdmin);

      expect(result.valid).toBe(true);
      expect(result.checksum).toBe('1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
      expect(result.mimeType).toBe('application/pdf');
      expect(result.extension).toBe('pdf');
      expect(result.size).toBe(1024);

      expect(mockFileValidationService.validateFile).toHaveBeenCalledWith({
        buffer: mockFile.buffer,
        originalName: 'syllabus.pdf',
        declaredMimeType: 'application/pdf',
        spaceId: 'space-1',
      });
    });
  });

  describe('findDocumentById', () => {
    it('throws NotFoundException if document does not exist', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(null);

      await expect(service.findDocumentById('doc-unknown', platformAdmin)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns document if user has school access', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce({
        id: 'doc-1',
        title: 'Notes',
        author: 'Prof',
        tags: 'math',
        space: { schoolId: 'school-1' },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const doc = await service.findDocumentById('doc-1', schoolAdmin);
      expect(doc.id).toBe('doc-1');
      expect(doc.title).toBe('Notes');
    });
  });

  describe('uploadPdf', () => {
    const validPdfFile = {
      buffer: Buffer.from('%PDF-1.4\nNative or scanned PDF stream payload'),
      originalname: 'Operating-Systems-101.pdf',
      mimetype: 'application/pdf',
      size: 45,
    } as UploadedFile;

    it('throws NotFoundException if target space does not exist', async () => {
      mockPrisma.space.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.uploadPdf('space-missing', validPdfFile, {}, schoolAdmin),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException if user lacks documents:create permission in space school', async () => {
      mockPrisma.space.findUnique.mockResolvedValueOnce({
        id: 'space-2',
        schoolId: 'school-2', // Out of scope for schoolAdmin (school-1)
      });

      await expect(
        service.uploadPdf('space-2', validPdfFile, {}, schoolAdmin),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException if file is missing or empty buffer', async () => {
      mockPrisma.space.findUnique.mockResolvedValue({
        id: 'space-1',
        schoolId: 'school-1',
      });

      await expect(
        service.uploadPdf('space-1', null as unknown as UploadedFile, {}, schoolAdmin),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.uploadPdf('space-1', { buffer: Buffer.alloc(0) } as UploadedFile, {}, schoolAdmin),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if validated file is not a PDF', async () => {
      mockPrisma.space.findUnique.mockResolvedValueOnce({
        id: 'space-1',
        schoolId: 'school-1',
      });

      mockFileValidationService.validateFile.mockResolvedValueOnce({
        checksum: 'checksum123',
        mimeType: 'image/png',
        extension: 'png',
        size: 50,
      });

      const imageFile = {
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        originalname: 'image.png',
        mimetype: 'image/png',
      } as UploadedFile;

      await expect(
        service.uploadPdf('space-1', imageFile, {}, schoolAdmin),
      ).rejects.toThrow(/Only PDF documents are supported/);
    });

    it('successfully uploads a native PDF, stores file, creates version with status pending, and enqueues job', async () => {
      mockPrisma.space.findUnique.mockResolvedValueOnce({
        id: 'space-1',
        schoolId: 'school-1',
      });

      mockFileValidationService.validateFile.mockResolvedValueOnce({
        checksum: 'sha256-checksum-hex',
        mimeType: 'application/pdf',
        extension: 'pdf',
        size: validPdfFile.buffer.length,
      });

      mockPrisma.document.create.mockImplementation(async ({ data }: any) => ({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      }));

      mockPrisma.documentVersion.create.mockImplementation(async ({ data }: any) => ({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      mockPrisma.processingJob.create.mockImplementation(async ({ data }: any) => ({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const result = await service.uploadPdf(
        'space-1',
        validPdfFile,
        {
          title: 'Custom OS Syllabus',
          author: 'Prof. Tanenbaum',
          tags: 'os,minix,kernel',
        },
        schoolAdmin,
      );

      // Verify returned document entity
      expect(result.title).toBe('Custom OS Syllabus');
      expect(result.author).toBe('Prof. Tanenbaum');
      expect(result.tags).toBe('os,minix,kernel');
      expect(result.spaceId).toBe('space-1');

      // Verify version 1 status is pending
      expect(result.currentVersion).toBeDefined();
      expect(result.currentVersion?.versionNo).toBe(1);
      expect(result.currentVersion?.status).toBe('pending');
      expect(result.currentVersion?.checksum).toBe('sha256-checksum-hex');
      expect(result.currentVersion?.mimeType).toBe('application/pdf');

      // Verify file was saved via StorageService
      expect(mockStorageService.save).toHaveBeenCalledWith(
        expect.stringMatching(/^spaces\/space-1\/docs\/[a-f0-9-]+\/v1\.pdf$/),
        validPdfFile.buffer,
      );

      // Verify processing job was enqueued
      expect(mockProcessingQueueService.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: expect.any(String),
          versionId: expect.any(String),
          documentId: expect.any(String),
          spaceId: 'space-1',
          mimeType: 'application/pdf',
        }),
      );
    });

    it('uploads a scanned PDF and sanitizes title from originalname when title not provided', async () => {
      mockPrisma.space.findUnique.mockResolvedValueOnce({
        id: 'space-1',
        schoolId: 'school-1',
      });

      mockFileValidationService.validateFile.mockResolvedValueOnce({
        checksum: 'scanned-pdf-checksum',
        mimeType: 'application/pdf',
        extension: 'pdf',
        size: 100,
      });

      mockPrisma.document.create.mockImplementation(async ({ data }: any) => ({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      }));

      mockPrisma.documentVersion.create.mockImplementation(async ({ data }: any) => ({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const scannedFile = {
        buffer: Buffer.from('%PDF-1.5 scanned image wrapper'),
        originalname: 'Scanned-Math-Exam-2026.pdf',
        mimetype: 'application/pdf',
      } as UploadedFile;

      const result = await service.uploadPdf('space-1', scannedFile, {}, schoolAdmin);

      expect(result.title).toBe('Scanned-Math-Exam-2026');
      expect(result.author).toBe('School Admin'); // Falls back to actor fullName
      expect(result.currentVersion?.status).toBe('pending');
    });

    it('cleans up written storage file if database transaction fails', async () => {
      mockPrisma.space.findUnique.mockResolvedValueOnce({
        id: 'space-1',
        schoolId: 'school-1',
      });

      mockFileValidationService.validateFile.mockResolvedValueOnce({
        checksum: 'sha256-hex',
        mimeType: 'application/pdf',
        extension: 'pdf',
        size: 50,
      });

      mockPrisma.$transaction.mockRejectedValueOnce(new Error('Deadlock in MySQL'));

      await expect(
        service.uploadPdf('space-1', validPdfFile, {}, schoolAdmin),
      ).rejects.toThrow('Deadlock in MySQL');

      // Verifies storage was cleaned up
      expect(mockStorageService.delete).toHaveBeenCalledWith(
        expect.stringMatching(/^spaces\/space-1\/docs\/[a-f0-9-]+\/v1\.pdf$/),
      );
    });
  });

  describe('uploadImage', () => {
    const validJpegFile = {
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03]),
      originalname: 'Whiteboard-Notes.jpg',
      mimetype: 'image/jpeg',
      size: 7,
    } as UploadedFile;

    it('throws NotFoundException if space does not exist', async () => {
      mockPrisma.space.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.uploadImage('space-unknown', validJpegFile, {}, schoolAdmin),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException if user lacks rights to space school', async () => {
      mockPrisma.space.findUnique.mockResolvedValueOnce({
        id: 'space-2',
        schoolId: 'school-2',
      });

      await expect(
        service.uploadImage('space-2', validJpegFile, {}, schoolAdmin),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException if file is missing or empty buffer', async () => {
      mockPrisma.space.findUnique.mockResolvedValue({
        id: 'space-1',
        schoolId: 'school-1',
      });

      await expect(
        service.uploadImage('space-1', null as unknown as UploadedFile, {}, schoolAdmin),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.uploadImage('space-1', { buffer: Buffer.alloc(0) } as UploadedFile, {}, schoolAdmin),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if file is not an image (e.g. PDF)', async () => {
      mockPrisma.space.findUnique.mockResolvedValueOnce({
        id: 'space-1',
        schoolId: 'school-1',
      });

      mockFileValidationService.validateFile.mockResolvedValueOnce({
        checksum: 'pdf-checksum',
        mimeType: 'application/pdf',
        extension: 'pdf',
        size: 50,
      });

      const pdfFile = {
        buffer: Buffer.from('%PDF-1.4'),
        originalname: 'file.pdf',
        mimetype: 'application/pdf',
      } as UploadedFile;

      await expect(
        service.uploadImage('space-1', pdfFile, {}, schoolAdmin),
      ).rejects.toThrow(/Only JPEG, PNG, and HEIC images are supported/);
    });

    it('uploads a JPEG image and queues it for OCR', async () => {
      mockPrisma.space.findUnique.mockResolvedValueOnce({
        id: 'space-1',
        schoolId: 'school-1',
      });

      mockFileValidationService.validateFile.mockResolvedValueOnce({
        checksum: 'jpeg-checksum-123',
        mimeType: 'image/jpeg',
        extension: 'jpg',
        size: 7,
      });

      mockPrisma.document.create.mockImplementation(async ({ data }: any) => ({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      }));

      mockPrisma.documentVersion.create.mockImplementation(async ({ data }: any) => ({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      mockPrisma.processingJob.create.mockImplementation(async ({ data }: any) => ({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const result = await service.uploadImage(
        'space-1',
        validJpegFile,
        {
          title: 'Classroom Whiteboard Session',
          author: 'Alice Lecturer',
          tags: 'ocr,whiteboard',
        },
        schoolAdmin,
      );

      expect(result.title).toBe('Classroom Whiteboard Session');
      expect(result.author).toBe('Alice Lecturer');
      expect(result.currentVersion?.status).toBe('pending');
      expect(result.currentVersion?.mimeType).toBe('image/jpeg');
      expect(result.currentVersion?.pageCount).toBe(1);

      // Verify StorageService save
      expect(mockStorageService.save).toHaveBeenCalledWith(
        expect.stringMatching(/^spaces\/space-1\/docs\/[a-f0-9-]+\/v1\.jpg$/),
        validJpegFile.buffer,
      );

      // Verify ProcessingJob step is ocr
      expect(mockPrisma.processingJob.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          step: 'ocr',
          status: 'pending',
          pageCount: 1,
        }),
      });

      // Verify queue targeting OCR
      expect(mockProcessingQueueService.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          targetStep: 'ocr',
          mimeType: 'image/jpeg',
        }),
      );
    });

    it('uploads a PNG image and queues it for OCR', async () => {
      mockPrisma.space.findUnique.mockResolvedValueOnce({
        id: 'space-1',
        schoolId: 'school-1',
      });

      const pngFile = {
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]),
        originalname: 'diagram.png',
        mimetype: 'image/png',
      } as UploadedFile;

      mockFileValidationService.validateFile.mockResolvedValueOnce({
        checksum: 'png-checksum-456',
        mimeType: 'image/png',
        extension: 'png',
        size: 6,
      });

      mockPrisma.document.create.mockImplementation(async ({ data }: any) => ({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      }));

      mockPrisma.documentVersion.create.mockImplementation(async ({ data }: any) => ({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      mockPrisma.processingJob.create.mockImplementation(async ({ data }: any) => ({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const result = await service.uploadImage('space-1', pngFile, {}, schoolAdmin);

      expect(result.title).toBe('diagram');
      expect(result.currentVersion?.mimeType).toBe('image/png');
      expect(mockProcessingQueueService.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({ targetStep: 'ocr' }),
      );
    });

    it('converts HEIC to JPEG for OCR and saves the converted format', async () => {
      mockPrisma.space.findUnique.mockResolvedValueOnce({
        id: 'space-1',
        schoolId: 'school-1',
      });

      const heicFile = {
        buffer: Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]),
        originalname: 'mobile-photo.heic',
        mimetype: 'image/heic',
      } as UploadedFile;

      mockFileValidationService.validateFile.mockResolvedValueOnce({
        checksum: 'heic-original-checksum',
        mimeType: 'image/heic',
        extension: 'heic',
        size: 12,
      });

      mockPrisma.document.create.mockImplementation(async ({ data }: any) => ({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      }));

      mockPrisma.documentVersion.create.mockImplementation(async ({ data }: any) => ({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      mockPrisma.processingJob.create.mockImplementation(async ({ data }: any) => ({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const result = await service.uploadImage('space-1', heicFile, {}, schoolAdmin);

      // Converted to JPEG for OCR
      expect(mockImageConversionService.prepareImageForOcr).toHaveBeenCalledWith(
        heicFile.buffer,
        'image/heic',
      );
      expect(result.currentVersion?.mimeType).toBe('image/jpeg');
      expect(mockStorageService.save).toHaveBeenCalledWith(
        expect.stringMatching(/^spaces\/space-1\/docs\/[a-f0-9-]+\/v1\.jpg$/),
        expect.any(Buffer),
      );
    });

    it('cleans up written storage file if database transaction fails', async () => {
      mockPrisma.space.findUnique.mockResolvedValueOnce({
        id: 'space-1',
        schoolId: 'school-1',
      });

      mockFileValidationService.validateFile.mockResolvedValueOnce({
        checksum: 'checksum-error',
        mimeType: 'image/jpeg',
        extension: 'jpg',
        size: 7,
      });

      mockPrisma.$transaction.mockRejectedValueOnce(new Error('DB failure'));

      await expect(
        service.uploadImage('space-1', validJpegFile, {}, schoolAdmin),
      ).rejects.toThrow('DB failure');

      expect(mockStorageService.delete).toHaveBeenCalledWith(
        expect.stringMatching(/^spaces\/space-1\/docs\/[a-f0-9-]+\/v1\.jpg$/),
      );
    });
  });
});
