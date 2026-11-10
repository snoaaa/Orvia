import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { StorageService } from '../../storage/storage.service.js';
import type { UploadedFile } from '../interfaces/index.js';
import { RangeNotSatisfiableException } from '../utils/http-range.util.js';
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

  const studentUser: AuthenticatedUser = {
    id: 'user-student-1',
    email: 'student@school1.edu',
    fullName: 'Student Alice',
    status: 'ACTIVE',
    assignments: [
      {
        role: 'student',
        scope: 'school',
        schoolId: 'school-1',
        groupId: 'group-class-a',
        permissions: [],
      },
    ],
    permissions: [],
    schoolIds: ['school-1'],
    isPlatformAdmin: false,
    role: 'student',
    schoolId: 'school-1',
    sessionId: 'session-3',
  };

  const staffUser: AuthenticatedUser = {
    id: 'user-staff-1',
    email: 'staff@school1.edu',
    fullName: 'Staff Bob',
    status: 'ACTIVE',
    assignments: [
      {
        role: 'staff',
        scope: 'school',
        schoolId: 'school-1',
        groupId: null,
        permissions: [],
      },
    ],
    permissions: [],
    schoolIds: ['school-1'],
    isPlatformAdmin: false,
    role: 'staff',
    schoolId: 'school-1',
    sessionId: 'session-4',
  };

  const otherSchoolUser: AuthenticatedUser = {
    id: 'user-other-school',
    email: 'user@school2.edu',
    fullName: 'Other School User',
    status: 'ACTIVE',
    assignments: [
      {
        role: 'student',
        scope: 'school',
        schoolId: 'school-2',
        groupId: null,
        permissions: [],
      },
    ],
    permissions: [],
    schoolIds: ['school-2'],
    isPlatformAdmin: false,
    role: 'student',
    schoolId: 'school-2',
    sessionId: 'session-5',
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
        create: vi.fn().mockImplementation(async ({ data }: any) => ({
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        })),
        update: vi.fn(),
        count: vi.fn(),
      },
      documentVersion: {
        findFirst: vi.fn(),
        create: vi.fn().mockImplementation(async ({ data }: any) => ({
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      },
      messageReference: {
        findFirst: vi.fn(),
      },
      processingJob: {
        create: vi.fn().mockImplementation(async ({ data }: any) => ({
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      },
      $transaction: vi.fn().mockImplementation(async (cb) => cb(mockPrisma)),
    };

    mockFileValidationService = {
      validateFile: vi.fn(),
    };

    mockStorageService = {
      save: vi.fn().mockResolvedValue({ key: 'test', size: 100 }),
      delete: vi.fn().mockResolvedValue(true),
      read: vi.fn().mockImplementation(async () => Readable.from([Buffer.from('streamed file content bytes')])),
      getMetadata: vi.fn().mockResolvedValue({ size: 1000, lastModified: new Date('2026-11-10T12:00:00Z') }),
      exists: vi.fn().mockResolvedValue(true),
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

    it('throws BadRequestException if validated file is an image and directs to image endpoint', async () => {
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
      ).rejects.toThrow(/Images should be uploaded via the dedicated image upload endpoint/);
    });

    it('successfully uploads an enterprise Word document (.docx) and queues office_extraction', async () => {
      mockPrisma.space.findUnique.mockResolvedValueOnce({
        id: 'space-1',
        schoolId: 'school-1',
      });

      mockFileValidationService.validateFile.mockResolvedValueOnce({
        checksum: 'docx-checksum-hex',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        extension: 'docx',
        size: 1024,
      });

      let createdJobStep = '';
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
      mockPrisma.processingJob.create.mockImplementation(async ({ data }: any) => {
        createdJobStep = data.step;
        return {
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      });

      const docxFile = {
        buffer: Buffer.from('PK\x03\x04...word/document.xml...'),
        originalname: 'Assignment-1.docx',
        mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      } as UploadedFile;

      const result = await service.uploadPdf('space-1', docxFile, {}, schoolAdmin);

      expect(result.title).toBe('Assignment-1');
      expect(result.currentVersion?.mimeType).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      expect(createdJobStep).toBe('office_extraction');
      expect(mockStorageService.save).toHaveBeenCalledWith(
        expect.stringMatching(/^spaces\/space-1\/docs\/[a-f0-9-]+\/v1\.docx$/),
        docxFile.buffer,
      );
    });

    it('successfully uploads an enterprise PowerPoint (.pptx) and queues slide_extraction', async () => {
      mockPrisma.space.findUnique.mockResolvedValueOnce({
        id: 'space-1',
        schoolId: 'school-1',
      });

      mockFileValidationService.validateFile.mockResolvedValueOnce({
        checksum: 'pptx-checksum-hex',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        extension: 'pptx',
        size: 2048,
      });

      let createdJobStep = '';
      mockPrisma.processingJob.create.mockImplementation(async ({ data }: any) => {
        createdJobStep = data.step;
        return { ...data, createdAt: new Date(), updatedAt: new Date() };
      });

      const pptxFile = {
        buffer: Buffer.from('PK\x03\x04...ppt/presentation.xml...'),
        originalname: 'Lecture-01.pptx',
        mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      } as UploadedFile;

      await service.uploadPdf('space-1', pptxFile, {}, schoolAdmin);

      expect(createdJobStep).toBe('slide_extraction');
      expect(mockStorageService.save).toHaveBeenCalledWith(
        expect.stringMatching(/^spaces\/space-1\/docs\/[a-f0-9-]+\/v1\.pptx$/),
        pptxFile.buffer,
      );
    });

    it('successfully uploads an enterprise Excel (.xlsx) and queues tabular_extraction', async () => {
      mockPrisma.space.findUnique.mockResolvedValueOnce({
        id: 'space-1',
        schoolId: 'school-1',
      });

      mockFileValidationService.validateFile.mockResolvedValueOnce({
        checksum: 'xlsx-checksum-hex',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        extension: 'xlsx',
        size: 512,
      });

      let createdJobStep = '';
      mockPrisma.processingJob.create.mockImplementation(async ({ data }: any) => {
        createdJobStep = data.step;
        return { ...data, createdAt: new Date(), updatedAt: new Date() };
      });

      const xlsxFile = {
        buffer: Buffer.from('PK\x03\x04...xl/workbook.xml...'),
        originalname: 'Grades.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      } as UploadedFile;

      await service.uploadPdf('space-1', xlsxFile, {}, schoolAdmin);

      expect(createdJobStep).toBe('tabular_extraction');
      expect(mockStorageService.save).toHaveBeenCalledWith(
        expect.stringMatching(/^spaces\/space-1\/docs\/[a-f0-9-]+\/v1\.xlsx$/),
        xlsxFile.buffer,
      );
    });

    it('successfully uploads a Markdown (.md) or Text document and queues text_chunking', async () => {
      mockPrisma.space.findUnique.mockResolvedValueOnce({
        id: 'space-1',
        schoolId: 'school-1',
      });

      mockFileValidationService.validateFile.mockResolvedValueOnce({
        checksum: 'md-checksum-hex',
        mimeType: 'text/markdown',
        extension: 'md',
        size: 256,
      });

      let createdJobStep = '';
      mockPrisma.processingJob.create.mockImplementation(async ({ data }: any) => {
        createdJobStep = data.step;
        return { ...data, createdAt: new Date(), updatedAt: new Date() };
      });

      const mdFile = {
        buffer: Buffer.from('# Chapter 1: Introduction\n\nContent here.'),
        originalname: 'README.md',
        mimetype: 'text/markdown',
      } as UploadedFile;

      await service.uploadPdf('space-1', mdFile, {}, schoolAdmin);

      expect(createdJobStep).toBe('text_chunking');
      expect(mockStorageService.save).toHaveBeenCalledWith(
        expect.stringMatching(/^spaces\/space-1\/docs\/[a-f0-9-]+\/v1\.md$/),
        mdFile.buffer,
      );
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

  describe('getDocumentVersionStream', () => {
    const mockDocument = {
      id: 'doc-123',
      spaceId: 'space-1',
      title: 'Advanced Computer Architecture',
      deletedAt: null,
      space: { id: 'space-1', schoolId: 'school-1', privacy: 'public' },
      access: [],
    };

    const mockVersion1 = {
      id: 'ver-v1',
      documentId: 'doc-123',
      versionNo: 1,
      storageKey: 'spaces/space-1/docs/doc-123/v1.pdf',
      mimeType: 'application/pdf',
      checksum: 'sha256-v1-checksum',
      updatedAt: new Date('2026-11-01T10:00:00Z'),
    };

    const mockVersion2 = {
      id: 'ver-v2',
      documentId: 'doc-123',
      versionNo: 2,
      storageKey: 'spaces/space-1/docs/doc-123/v2.pdf',
      mimeType: 'application/pdf',
      checksum: 'sha256-v2-checksum',
      updatedAt: new Date('2026-11-05T10:00:00Z'),
    };

    it('throws NotFoundException if document does not exist', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.getDocumentVersionStream({
          documentId: 'doc-missing',
          actor: platformAdmin,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException if document is soft-deleted', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce({
        ...mockDocument,
        deletedAt: new Date(),
      });

      await expect(
        service.getDocumentVersionStream({
          documentId: 'doc-123',
          actor: platformAdmin,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException if requested version is not found', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(mockDocument);
      mockPrisma.documentVersion.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.getDocumentVersionStream({
          documentId: 'doc-123',
          versionRef: '99',
          actor: platformAdmin,
        }),
      ).rejects.toThrow(/Version 99 not found/);
    });

    it('platform admin can download any version of any document without restriction', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(mockDocument);
      mockPrisma.documentVersion.findFirst.mockResolvedValueOnce(mockVersion1);

      const result = await service.getDocumentVersionStream({
        documentId: 'doc-123',
        versionRef: '1',
        actor: platformAdmin,
      });

      expect(result.statusCode).toBe(200);
      expect(result.headers['Content-Type']).toBe('application/pdf');
      expect(result.headers['Content-Length']).toBe(1000);
      expect(result.headers['Accept-Ranges']).toBe('bytes');
      expect(result.filename).toBe('Advanced Computer Architecture.pdf');
      expect(mockStorageService.read).toHaveBeenCalledWith(mockVersion1.storageKey, {
        start: 0,
        end: 999,
      });
    });

    it('school admin can download any version (current or historical) of documents in their school', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(mockDocument);
      // Historical version 1 requested
      mockPrisma.documentVersion.findFirst.mockResolvedValueOnce(mockVersion1);

      const result = await service.getDocumentVersionStream({
        documentId: 'doc-123',
        versionRef: '1',
        actor: schoolAdmin,
      });

      expect(result.statusCode).toBe(200);
      expect(result.filename).toBe('Advanced Computer Architecture.pdf');
    });

    it('throws ForbiddenException if user belongs to a different school', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(mockDocument);
      mockPrisma.documentVersion.findFirst.mockResolvedValueOnce(mockVersion2);

      await expect(
        service.getDocumentVersionStream({
          documentId: 'doc-123',
          actor: otherSchoolUser,
        }),
      ).rejects.toThrow(/You do not have access to documents in this school/);
    });

    it('student can download current version when document has no restrictive rules in their school', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(mockDocument);
      // Resolving latest version:
      mockPrisma.documentVersion.findFirst
        .mockResolvedValueOnce(mockVersion2) // target version resolution
        .mockResolvedValueOnce(mockVersion2); // latestVersion comparison check

      mockPrisma.messageReference.findFirst.mockResolvedValueOnce(null);

      const result = await service.getDocumentVersionStream({
        documentId: 'doc-123',
        actor: studentUser,
      });

      expect(result.statusCode).toBe(200);
      expect(result.headers['Content-Disposition']).toContain('attachment');
    });

    it('student can download current version when document is published to their group', async () => {
      const groupPublishedDoc = {
        ...mockDocument,
        access: [
          { schoolId: 'school-1', roleId: null, groupId: 'group-class-a' },
        ],
      };

      mockPrisma.document.findUnique.mockResolvedValueOnce(groupPublishedDoc);
      mockPrisma.documentVersion.findFirst
        .mockResolvedValueOnce(mockVersion2) // target version
        .mockResolvedValueOnce(mockVersion2); // latest version

      mockPrisma.messageReference.findFirst.mockResolvedValueOnce(null);

      const result = await service.getDocumentVersionStream({
        documentId: 'doc-123',
        actor: studentUser,
      });

      expect(result.statusCode).toBe(200);
    });

    it('staff without document management rights can download current version when published to staff role', async () => {
      const staffDoc = {
        ...mockDocument,
        access: [
          { schoolId: 'school-1', roleId: 'staff', groupId: null },
        ],
      };

      mockPrisma.document.findUnique.mockResolvedValueOnce(staffDoc);
      mockPrisma.documentVersion.findFirst
        .mockResolvedValueOnce(mockVersion2)
        .mockResolvedValueOnce(mockVersion2);

      mockPrisma.messageReference.findFirst.mockResolvedValueOnce(null);

      const result = await service.getDocumentVersionStream({
        documentId: 'doc-123',
        actor: staffUser,
      });

      expect(result.statusCode).toBe(200);
    });

    it('throws ForbiddenException if document has access rules that do not match student group or role', async () => {
      const restrictedDoc = {
        ...mockDocument,
        access: [
          { schoolId: 'school-1', roleId: null, groupId: 'group-different-class' },
        ],
      };

      mockPrisma.document.findUnique.mockResolvedValueOnce(restrictedDoc);
      mockPrisma.documentVersion.findFirst
        .mockResolvedValueOnce(mockVersion2)
        .mockResolvedValueOnce(mockVersion2);

      mockPrisma.messageReference.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.getDocumentVersionStream({
          documentId: 'doc-123',
          actor: studentUser,
        }),
      ).rejects.toThrow(/This document is not published to your school, role, or group/);
    });

    it('throws ForbiddenException if non-manager tries to download historical version not cited in their answers', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(mockDocument);
      // Requesting historical version 1:
      mockPrisma.documentVersion.findFirst
        .mockResolvedValueOnce(mockVersion1) // target version 1
        .mockResolvedValueOnce(mockVersion2); // latest version is version 2!

      // Not cited:
      mockPrisma.messageReference.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.getDocumentVersionStream({
          documentId: 'doc-123',
          versionRef: '1',
          actor: studentUser,
        }),
      ).rejects.toThrow(
        /Historical document versions can only be accessed by document managers or when cited in your conversations/,
      );
    });

    it('student can download historical version when it is cited in their conversation answer', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(mockDocument);
      mockPrisma.documentVersion.findFirst.mockResolvedValueOnce(mockVersion1);

      // Cited in user's own answers!
      mockPrisma.messageReference.findFirst.mockResolvedValueOnce({ id: 'ref-1' });

      const result = await service.getDocumentVersionStream({
        documentId: 'doc-123',
        versionRef: '1',
        actor: studentUser,
      });

      expect(result.statusCode).toBe(200);
      expect(result.filename).toBe('Advanced Computer Architecture.pdf');
    });

    it('handles HTTP range request with 206 Partial Content (bytes=0-499)', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(mockDocument);
      mockPrisma.documentVersion.findFirst.mockResolvedValueOnce(mockVersion1);

      const result = await service.getDocumentVersionStream({
        documentId: 'doc-123',
        actor: platformAdmin,
        rangeHeader: 'bytes=0-499',
      });

      expect(result.statusCode).toBe(206);
      expect(result.headers['Content-Range']).toBe('bytes 0-499/1000');
      expect(result.headers['Content-Length']).toBe(500);
      expect(mockStorageService.read).toHaveBeenCalledWith(mockVersion1.storageKey, {
        start: 0,
        end: 499,
      });
    });

    it('handles open-ended range request (bytes=500-)', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(mockDocument);
      mockPrisma.documentVersion.findFirst.mockResolvedValueOnce(mockVersion1);

      const result = await service.getDocumentVersionStream({
        documentId: 'doc-123',
        actor: platformAdmin,
        rangeHeader: 'bytes=500-',
      });

      expect(result.statusCode).toBe(206);
      expect(result.headers['Content-Range']).toBe('bytes 500-999/1000');
      expect(result.headers['Content-Length']).toBe(500);
      expect(mockStorageService.read).toHaveBeenCalledWith(mockVersion1.storageKey, {
        start: 500,
        end: 999,
      });
    });

    it('handles suffix range request (bytes=-200)', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(mockDocument);
      mockPrisma.documentVersion.findFirst.mockResolvedValueOnce(mockVersion1);

      const result = await service.getDocumentVersionStream({
        documentId: 'doc-123',
        actor: platformAdmin,
        rangeHeader: 'bytes=-200',
      });

      expect(result.statusCode).toBe(206);
      expect(result.headers['Content-Range']).toBe('bytes 800-999/1000');
      expect(result.headers['Content-Length']).toBe(200);
      expect(mockStorageService.read).toHaveBeenCalledWith(mockVersion1.storageKey, {
        start: 800,
        end: 999,
      });
    });

    it('throws RangeNotSatisfiableException when range is beyond file bounds', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(mockDocument);
      mockPrisma.documentVersion.findFirst.mockResolvedValueOnce(mockVersion1);

      await expect(
        service.getDocumentVersionStream({
          documentId: 'doc-123',
          actor: platformAdmin,
          rangeHeader: 'bytes=2000-',
        }),
      ).rejects.toThrow(RangeNotSatisfiableException);
    });

    it('sets inline Content-Disposition when disposition is inline for viewer streaming', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(mockDocument);
      mockPrisma.documentVersion.findFirst.mockResolvedValueOnce(mockVersion1);

      const result = await service.getDocumentVersionStream({
        documentId: 'doc-123',
        actor: platformAdmin,
        disposition: 'inline',
      });

      expect(result.headers['Content-Disposition']).toMatch(/^inline;/);
    });
  });
});
