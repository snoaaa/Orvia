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
import type { AuditService } from '../../audit/services/audit.service.js';

describe('DocumentsService', () => {
  let service: DocumentsService;
  let mockPrisma: any;
  let mockFileValidationService: any;
  let mockStorageService: any;
  let mockProcessingQueueService: any;
  let mockImageConversionService: any;
  let mockAudit: any;

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
        permissions: ['documents:create', 'documents:read', 'documents:update', 'documents:delete', '*'],
      },
    ],
    permissions: ['documents:create', 'documents:read', 'documents:update', 'documents:delete', '*'],
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
        permissions: ['documents:create', 'documents:read', 'documents:update', 'documents:delete', 'spaces:read', 'spaces:create'],
      },
    ],
    permissions: ['documents:create', 'documents:read', 'documents:update', 'documents:delete', 'spaces:read', 'spaces:create'],
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
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn().mockImplementation(async ({ data }: any) => ({
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      },
      auditEvent: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([]),
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

    mockAudit = {
      record: vi.fn().mockResolvedValue({}),
    };

    service = new DocumentsService(
      mockPrisma as unknown as PrismaService,
      mockFileValidationService as unknown as FileValidationService,
      mockStorageService as unknown as StorageService,
      mockProcessingQueueService as unknown as ProcessingQueueService,
      mockImageConversionService as unknown as ImageConversionService,
      mockAudit as unknown as AuditService,
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

  describe('findSpaceById (#89)', () => {
    it('throws NotFoundException if space does not exist', async () => {
      mockPrisma.space.findUnique.mockResolvedValueOnce(null);

      await expect(service.findSpaceById('space-missing', platformAdmin)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns space when school admin has access to the space school', async () => {
      mockPrisma.space.findUnique.mockResolvedValueOnce({
        id: 'space-1',
        schoolId: 'school-1',
        name: 'Computer Science',
        privacy: 'public',
        description: 'CS Docs',
        createdAt: new Date(),
        updatedAt: new Date(),
        school: { id: 'school-1', name: 'Engineering College' },
      });

      const space = await service.findSpaceById('space-1', schoolAdmin);
      expect(space.id).toBe('space-1');
      expect(space.name).toBe('Computer Science');
      expect(space.schoolId).toBe('school-1');
    });

    it('returns space for platform admin regardless of school', async () => {
      mockPrisma.space.findUnique.mockResolvedValueOnce({
        id: 'space-2',
        schoolId: 'school-other',
        name: 'Biology',
        privacy: 'public',
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        school: { id: 'school-other', name: 'Medical School' },
      });

      const space = await service.findSpaceById('space-2', platformAdmin);
      expect(space.id).toBe('space-2');
      expect(space.schoolId).toBe('school-other');
    });

    it('throws ForbiddenException when caller accesses space of another school', async () => {
      mockPrisma.space.findUnique.mockResolvedValueOnce({
        id: 'space-other',
        schoolId: 'school-other',
        name: 'Law',
        privacy: 'public',
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        school: { id: 'school-other', name: 'Law School' },
      });

      await expect(service.findSpaceById('space-other', schoolAdmin)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('updateDocument', () => {
    const existingDoc = {
      id: 'doc-1',
      spaceId: 'space-1',
      title: 'Operating Systems Syllabus',
      author: 'Prof. Tanenbaum',
      tags: 'os,minix',
      createdAt: new Date('2026-09-01T08:00:00.000Z'),
      updatedAt: new Date('2026-09-01T08:00:00.000Z'),
      deletedAt: null,
      space: { schoolId: 'school-1' },
    };

    it('throws NotFoundException if document does not exist', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.updateDocument('doc-missing', { title: 'New Title' }, schoolAdmin),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException if document is soft-deleted', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce({
        ...existingDoc,
        deletedAt: new Date(),
      });

      await expect(
        service.updateDocument('doc-1', { title: 'New Title' }, schoolAdmin),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException if user lacks documents:update permission in space school', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce({
        ...existingDoc,
        space: { schoolId: 'school-2' },
      });

      await expect(
        service.updateDocument('doc-1', { title: 'New Title' }, schoolAdmin),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException if title is empty string or only whitespace', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(existingDoc);

      await expect(
        service.updateDocument('doc-1', { title: '   ' }, schoolAdmin),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if date format is invalid', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(existingDoc);

      await expect(
        service.updateDocument('doc-1', { date: 'invalid-date-string' }, schoolAdmin),
      ).rejects.toThrow(BadRequestException);
    });

    it('successfully updates title, author, tags, and date, writing hash-chained audit event', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(existingDoc);

      const newDate = new Date('2026-10-15T09:00:00.000Z');
      const updatedDoc = {
        ...existingDoc,
        title: 'Modern Operating Systems (Rev 3)',
        author: 'Prof. Andrew S. Tanenbaum',
        tags: 'os,minix,linux,kernel',
        createdAt: newDate,
        updatedAt: new Date(),
      };

      mockPrisma.document.update.mockResolvedValueOnce(updatedDoc);
      mockPrisma.documentVersion.findFirst.mockResolvedValueOnce({
        id: 'ver-1',
        versionNo: 1,
        status: 'indexed',
      });

      const result = await service.updateDocument(
        'doc-1',
        {
          title: '  Modern Operating Systems (Rev 3)  ',
          author: 'Prof. Andrew S. Tanenbaum',
          tags: 'os,minix,linux,kernel',
          date: '2026-10-15T09:00:00.000Z',
        },
        schoolAdmin,
      );

      expect(result.id).toBe('doc-1');
      expect(result.title).toBe('Modern Operating Systems (Rev 3)');
      expect(result.author).toBe('Prof. Andrew S. Tanenbaum');
      expect(result.tags).toBe('os,minix,linux,kernel');
      expect(result.createdAt).toEqual(newDate);

      // Verify update payload in Prisma
      expect(mockPrisma.document.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: {
          title: 'Modern Operating Systems (Rev 3)',
          author: 'Prof. Andrew S. Tanenbaum',
          tags: 'os,minix,linux,kernel',
          createdAt: newDate,
        },
      });

      // Verify audit event
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'documents',
          action: 'document_updated',
          entity: { type: 'document', id: 'doc-1' },
          details: expect.objectContaining({
            spaceId: 'space-1',
            schoolId: 'school-1',
            changes: expect.objectContaining({
              title: { from: existingDoc.title, to: 'Modern Operating Systems (Rev 3)' },
              author: { from: existingDoc.author, to: 'Prof. Andrew S. Tanenbaum' },
              tags: { from: existingDoc.tags, to: 'os,minix,linux,kernel' },
              date: { from: existingDoc.createdAt.toISOString(), to: newDate.toISOString() },
            }),
          }),
        }),
      );
    });

    it('platform admin can update document metadata on any school space', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce({
        ...existingDoc,
        space: { schoolId: 'school-arbitrary-99' },
      });

      mockPrisma.document.update.mockResolvedValueOnce({
        ...existingDoc,
        title: 'Platform Admin Edit',
      });
      mockPrisma.documentVersion.findFirst.mockResolvedValueOnce(null);

      const result = await service.updateDocument(
        'doc-1',
        { title: 'Platform Admin Edit' },
        platformAdmin,
      );

      expect(result.title).toBe('Platform Admin Edit');
      expect(mockAudit.record).toHaveBeenCalled();
    });

    it('does not write audit event if no values actually changed', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(existingDoc);
      mockPrisma.document.update.mockResolvedValueOnce(existingDoc);
      mockPrisma.documentVersion.findFirst.mockResolvedValueOnce(null);

      await service.updateDocument(
        'doc-1',
        {
          title: existingDoc.title,
          author: existingDoc.author,
        },
        schoolAdmin,
      );

      expect(mockAudit.record).not.toHaveBeenCalled();
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

  describe('replaceDocumentVersion', () => {
    const existingDoc = {
      id: 'doc-1',
      spaceId: 'space-1',
      title: 'Operating Systems Syllabus',
      author: 'Prof. Tanenbaum',
      tags: 'os,minix',
      createdAt: new Date('2026-09-01T08:00:00.000Z'),
      updatedAt: new Date('2026-09-01T08:00:00.000Z'),
      deletedAt: null,
      space: { schoolId: 'school-1' },
    };

    const mockPdfFile = {
      buffer: Buffer.from('%PDF-1.4\nNew revision content for OS Syllabus'),
      originalname: 'OS-Syllabus-2026-Rev2.pdf',
      mimetype: 'application/pdf',
      size: 50,
    } as UploadedFile;

    it('throws NotFoundException if target document does not exist', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.replaceDocumentVersion('doc-missing', mockPdfFile, schoolAdmin),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException if target document is soft-deleted', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce({
        ...existingDoc,
        deletedAt: new Date(),
      });

      await expect(
        service.replaceDocumentVersion('doc-1', mockPdfFile, schoolAdmin),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException if user lacks documents:update permission in space school', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce({
        ...existingDoc,
        space: { schoolId: 'school-2' },
      });

      await expect(
        service.replaceDocumentVersion('doc-1', mockPdfFile, schoolAdmin),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException if replacement file is missing or empty buffer', async () => {
      mockPrisma.document.findUnique.mockResolvedValue(existingDoc);

      await expect(
        service.replaceDocumentVersion('doc-1', null as unknown as UploadedFile, schoolAdmin),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.replaceDocumentVersion('doc-1', { buffer: Buffer.alloc(0) } as UploadedFile, schoolAdmin),
      ).rejects.toThrow(BadRequestException);
    });

    it('successfully replaces document with incremented version (v1 -> v2) for PDF, saves to storage, and queues ingestion job', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(existingDoc);

      mockFileValidationService.validateFile.mockResolvedValueOnce({
        checksum: 'v2-pdf-checksum-hex',
        mimeType: 'application/pdf',
        extension: 'pdf',
        size: mockPdfFile.buffer.length,
      });

      // Existing latest version is v1
      mockPrisma.documentVersion.findFirst.mockResolvedValueOnce({
        id: 'ver-1',
        versionNo: 1,
      });

      let createdVersionRecord: any;
      let createdJobRecord: any;
      mockPrisma.documentVersion.create.mockImplementation(async ({ data }: any) => {
        createdVersionRecord = {
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        return createdVersionRecord;
      });

      mockPrisma.processingJob.create.mockImplementation(async ({ data }: any) => {
        createdJobRecord = {
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        return createdJobRecord;
      });

      mockPrisma.document.update.mockResolvedValueOnce({
        ...existingDoc,
        updatedAt: new Date(),
      });

      const result = await service.replaceDocumentVersion('doc-1', mockPdfFile, schoolAdmin);

      // Verify returned document entity has version 2 with status pending
      expect(result.id).toBe('doc-1');
      expect(result.currentVersion?.versionNo).toBe(2);
      expect(result.currentVersion?.status).toBe('pending');
      expect(result.currentVersion?.mimeType).toBe('application/pdf');

      // Verify storage key incremented to v2
      expect(mockStorageService.save).toHaveBeenCalledWith(
        'spaces/space-1/docs/doc-1/v2.pdf',
        mockPdfFile.buffer,
      );

      // Verify processing job step
      expect(createdJobRecord.step).toBe('ingestion');
      expect(createdJobRecord.status).toBe('pending');

      // Verify processing queue dispatch
      expect(mockProcessingQueueService.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-1',
          spaceId: 'space-1',
          storageKey: 'spaces/space-1/docs/doc-1/v2.pdf',
          mimeType: 'application/pdf',
        }),
      );

      // Verify audit event
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'documents',
          action: 'document_replaced',
          entity: { type: 'document', id: 'doc-1' },
          details: expect.objectContaining({
            versionNo: 2,
            spaceId: 'space-1',
            schoolId: 'school-1',
            checksum: 'v2-pdf-checksum-hex',
            mimeType: 'application/pdf',
          }),
        }),
      );
    });

    it('successfully replaces document with Word document (.docx) and queues office_extraction', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(existingDoc);

      const docxFile = {
        buffer: Buffer.from('PK\x03\x04...word/document.xml...'),
        originalname: 'Syllabus-v2.docx',
        mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      } as UploadedFile;

      mockFileValidationService.validateFile.mockResolvedValueOnce({
        checksum: 'docx-checksum',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        extension: 'docx',
        size: docxFile.buffer.length,
      });

      mockPrisma.documentVersion.findFirst.mockResolvedValueOnce({
        versionNo: 2, // existing version is 2, next should be 3!
      });

      let createdJobStep = '';
      mockPrisma.processingJob.create.mockImplementation(async ({ data }: any) => {
        createdJobStep = data.step;
        return { ...data, createdAt: new Date(), updatedAt: new Date() };
      });
      mockPrisma.document.update.mockResolvedValueOnce(existingDoc);

      const result = await service.replaceDocumentVersion('doc-1', docxFile, schoolAdmin);

      expect(result.currentVersion?.versionNo).toBe(3);
      expect(createdJobStep).toBe('office_extraction');
      expect(mockStorageService.save).toHaveBeenCalledWith(
        'spaces/space-1/docs/doc-1/v3.docx',
        docxFile.buffer,
      );
    });

    it('successfully replaces document with HEIC photo, converts to JPEG, and queues OCR', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(existingDoc);

      const heicFile = {
        buffer: Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]),
        originalname: 'whiteboard-v2.heic',
        mimetype: 'image/heic',
      } as UploadedFile;

      mockFileValidationService.validateFile.mockResolvedValueOnce({
        checksum: 'heic-checksum',
        mimeType: 'image/heic',
        extension: 'heic',
        size: 12,
      });

      mockPrisma.documentVersion.findFirst.mockResolvedValueOnce({
        versionNo: 1,
      });
      mockPrisma.document.update.mockResolvedValueOnce(existingDoc);

      let createdJobStep = '';
      mockPrisma.processingJob.create.mockImplementation(async ({ data }: any) => {
        createdJobStep = data.step;
        return { ...data, createdAt: new Date(), updatedAt: new Date() };
      });

      const result = await service.replaceDocumentVersion('doc-1', heicFile, schoolAdmin);

      expect(result.currentVersion?.versionNo).toBe(2);
      expect(result.currentVersion?.mimeType).toBe('image/jpeg');
      expect(createdJobStep).toBe('ocr');
      expect(mockImageConversionService.prepareImageForOcr).toHaveBeenCalledWith(
        heicFile.buffer,
        'image/heic',
      );
      expect(mockStorageService.save).toHaveBeenCalledWith(
        'spaces/space-1/docs/doc-1/v2.jpg',
        expect.any(Buffer),
      );
    });

    it('cleans up written storage file if database transaction fails', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(existingDoc);

      mockFileValidationService.validateFile.mockResolvedValueOnce({
        checksum: 'v2-pdf-checksum',
        mimeType: 'application/pdf',
        extension: 'pdf',
        size: mockPdfFile.buffer.length,
      });

      mockPrisma.documentVersion.findFirst.mockResolvedValueOnce({
        versionNo: 1,
      });

      mockPrisma.$transaction.mockRejectedValueOnce(new Error('Prisma write deadlock'));

      await expect(
        service.replaceDocumentVersion('doc-1', mockPdfFile, schoolAdmin),
      ).rejects.toThrow('Prisma write deadlock');

      expect(mockStorageService.delete).toHaveBeenCalledWith(
        'spaces/space-1/docs/doc-1/v2.pdf',
      );
    });
  });

  describe('listDocumentVersions (#107)', () => {
    const existingDoc = {
      id: 'doc-1',
      spaceId: 'space-1',
      title: 'Operating Systems',
      author: 'Prof. Tanenbaum',
      tags: 'os,systems',
      deletedAt: null,
      createdAt: new Date('2026-10-10T10:00:00Z'),
      updatedAt: new Date('2026-10-10T10:00:00Z'),
      space: { schoolId: 'school-1' },
    };

    const mockVersions = [
      {
        id: 'ver-2',
        documentId: 'doc-1',
        versionNo: 2,
        storageKey: 'spaces/space-1/docs/doc-1/v2.pdf',
        mimeType: 'application/pdf',
        checksum: 'checksum-v2',
        status: 'pending',
        pageCount: 10,
        createdAt: new Date('2026-10-20T10:00:00Z'),
        updatedAt: new Date('2026-10-20T10:00:00Z'),
      },
      {
        id: 'ver-1',
        documentId: 'doc-1',
        versionNo: 1,
        storageKey: 'spaces/space-1/docs/doc-1/v1.pdf',
        mimeType: 'application/pdf',
        checksum: 'checksum-v1',
        status: 'indexed',
        pageCount: 10,
        createdAt: new Date('2026-10-10T10:00:00Z'),
        updatedAt: new Date('2026-10-10T10:00:00Z'),
      },
    ];

    it('lists versions ordered newest first with size, uploader, checksum, status, and isCurrent', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(existingDoc);
      mockPrisma.documentVersion.findMany.mockResolvedValueOnce(mockVersions);

      mockStorageService.getMetadata
        .mockResolvedValueOnce({ size: 2048 })
        .mockResolvedValueOnce({ size: 1024 });

      mockPrisma.auditEvent.findMany.mockResolvedValueOnce([
        {
          actorId: 'usr-admin',
          details: { versionId: 'ver-2', versionNo: 2 },
          createdAt: new Date('2026-10-20T10:00:00Z'),
        },
        {
          actorId: 'usr-prof',
          details: { versionId: 'ver-1', versionNo: 1 },
          createdAt: new Date('2026-10-10T10:00:00Z'),
        },
      ]);

      mockPrisma.user.findMany.mockResolvedValueOnce([
        { id: 'usr-admin', name: 'Admin Alice', email: 'admin@school1.edu' },
        { id: 'usr-prof', name: 'Prof Bob', email: 'prof@school1.edu' },
      ]);

      const result = await service.listDocumentVersions('doc-1', schoolAdmin);

      expect(mockPrisma.documentVersion.findMany).toHaveBeenCalledWith({
        where: { documentId: 'doc-1' },
        orderBy: { versionNo: 'desc' },
      });

      expect(result).toHaveLength(2);

      // Newest version first (v2)
      expect(result[0].versionNumber).toBe(2);
      expect(result[0].versionNo).toBe(2);
      expect(result[0].isCurrent).toBe(true);
      expect(result[0].size).toBe(2048);
      expect(result[0].checksum).toBe('checksum-v2');
      expect(result[0].status).toBe('pending');
      expect(result[0].uploader).toEqual({
        id: 'usr-admin',
        name: 'Admin Alice',
        email: 'admin@school1.edu',
      });

      // Older version (v1)
      expect(result[1].versionNumber).toBe(1);
      expect(result[1].versionNo).toBe(1);
      expect(result[1].isCurrent).toBe(false);
      expect(result[1].size).toBe(1024);
      expect(result[1].checksum).toBe('checksum-v1');
      expect(result[1].status).toBe('indexed');
      expect(result[1].uploader).toEqual({
        id: 'usr-prof',
        name: 'Prof Bob',
        email: 'prof@school1.edu',
      });
    });

    it('returns empty array if document has no versions', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(existingDoc);
      mockPrisma.documentVersion.findMany.mockResolvedValueOnce([]);

      const result = await service.listDocumentVersions('doc-1', schoolAdmin);

      expect(result).toEqual([]);
    });

    it('throws NotFoundException if document does not exist', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(null);

      await expect(service.listDocumentVersions('nonexistent-doc', schoolAdmin)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException if document is soft-deleted', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce({
        ...existingDoc,
        deletedAt: new Date(),
      });

      await expect(service.listDocumentVersions('doc-1', schoolAdmin)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException if mobile student user tries to list versions', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(existingDoc);

      await expect(service.listDocumentVersions('doc-1', studentUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException if user lacks documents:update in the space school', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(existingDoc);

      await expect(service.listDocumentVersions('doc-1', otherSchoolUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows platform admin to list versions for any document', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(existingDoc);
      mockPrisma.documentVersion.findMany.mockResolvedValueOnce([mockVersions[0]]);
      mockStorageService.getMetadata.mockResolvedValueOnce({ size: 5000 });
      mockPrisma.auditEvent.findMany.mockResolvedValueOnce([]);

      const result = await service.listDocumentVersions('doc-1', platformAdmin);

      expect(result).toHaveLength(1);
      expect(result[0].versionNo).toBe(2);
      expect(result[0].isCurrent).toBe(true);
      expect(result[0].size).toBe(5000);
      expect(result[0].uploader).toBeNull();
    });

    it('handles missing storage metadata gracefully by defaulting size to 0', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(existingDoc);
      mockPrisma.documentVersion.findMany.mockResolvedValueOnce([mockVersions[0]]);
      mockStorageService.getMetadata.mockRejectedValueOnce(new Error('ENOENT file not found'));
      mockPrisma.auditEvent.findMany.mockResolvedValueOnce([]);

      const result = await service.listDocumentVersions('doc-1', schoolAdmin);

      expect(result).toHaveLength(1);
      expect(result[0].size).toBe(0);
    });

    it('handles versions without audit event uploader gracefully by setting uploader to null', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(existingDoc);
      mockPrisma.documentVersion.findMany.mockResolvedValueOnce([mockVersions[0]]);
      mockStorageService.getMetadata.mockResolvedValueOnce({ size: 100 });
      mockPrisma.auditEvent.findMany.mockResolvedValueOnce([]);

      const result = await service.listDocumentVersions('doc-1', schoolAdmin);

      expect(result).toHaveLength(1);
      expect(result[0].uploader).toBeNull();
    });
  });

  describe('deleteDocument (#108)', () => {
    const existingDoc = {
      id: 'doc-1',
      spaceId: 'space-1',
      title: 'Operating Systems',
      author: 'Prof. Tanenbaum',
      tags: 'os,systems',
      deletedAt: null,
      createdAt: new Date('2026-10-10T10:00:00Z'),
      updatedAt: new Date('2026-10-10T10:00:00Z'),
      space: { schoolId: 'school-1' },
    };

    it('successfully soft-deletes a document and records an immutable audit event', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(existingDoc);
      mockPrisma.documentVersion.count.mockResolvedValueOnce(3);
      mockPrisma.document.update.mockResolvedValueOnce({
        ...existingDoc,
        deletedAt: new Date(),
      });

      const result = await service.deleteDocument('doc-1', schoolAdmin, { ip: '127.0.0.1' });

      expect(mockPrisma.document.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: { deletedAt: expect.any(Date) },
      });

      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'documents',
          action: 'document_deleted',
          entity: { type: 'document', id: 'doc-1' },
          details: expect.objectContaining({
            spaceId: 'space-1',
            schoolId: 'school-1',
            title: 'Operating Systems',
            versionsCount: 3,
          }),
        }),
      );

      expect(result).toEqual({
        success: true,
        id: 'doc-1',
        message: 'Document successfully soft-deleted',
      });
    });

    it('throws NotFoundException if document does not exist', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(null);

      await expect(service.deleteDocument('nonexistent-doc', schoolAdmin)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException if document is already soft-deleted', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce({
        ...existingDoc,
        deletedAt: new Date(),
      });

      await expect(service.deleteDocument('doc-1', schoolAdmin)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException if mobile student user attempts deletion', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(existingDoc);

      await expect(service.deleteDocument('doc-1', studentUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException if user lacks documents:delete in the space school', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(existingDoc);

      await expect(service.deleteDocument('doc-1', otherSchoolUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows platform admin to delete document across any school', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(existingDoc);
      mockPrisma.documentVersion.count.mockResolvedValueOnce(1);
      mockPrisma.document.update.mockResolvedValueOnce({
        ...existingDoc,
        deletedAt: new Date(),
      });

      const result = await service.deleteDocument('doc-1', platformAdmin);

      expect(result.success).toBe(true);
      expect(mockPrisma.document.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('findAllDocuments excludes soft-deleted documents by filtering deletedAt: null', async () => {
      mockPrisma.document.count.mockResolvedValueOnce(0);
      mockPrisma.document.findMany.mockResolvedValueOnce([]);

      await service.findAllDocuments(schoolAdmin);

      expect(mockPrisma.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
          }),
        }),
      );
    });
  });

  describe('Document-Management Permission Scoping (#88)', () => {
    const staffWithDocManage: AuthenticatedUser = {
      id: 'staff-with-manage-id',
      email: 'staff.manage@school1.edu',
      fullName: 'Staff Content Manager',
      status: 'ACTIVE',
      assignments: [
        {
          role: 'CONTENT_MANAGER',
          scope: 'school',
          schoolId: 'school-1',
          groupId: null,
          permissions: ['documents:manage'],
        },
      ],
      permissions: ['documents:manage'],
      schoolIds: ['school-1'],
      isPlatformAdmin: false,
      role: 'CONTENT_MANAGER',
      schoolId: 'school-1',
      sessionId: 'session-cm-1',
    };

    const staffWithoutDocManage: AuthenticatedUser = {
      id: 'staff-without-manage-id',
      email: 'staff.regular@school1.edu',
      fullName: 'Regular Staff',
      status: 'ACTIVE',
      assignments: [
        {
          role: 'STAFF',
          scope: 'school',
          schoolId: 'school-1',
          groupId: null,
          permissions: ['spaces:read', 'documents:read'],
        },
      ],
      permissions: ['spaces:read', 'documents:read'],
      schoolIds: ['school-1'],
      isPlatformAdmin: false,
      role: 'STAFF',
      schoolId: 'school-1',
      sessionId: 'session-staff-1',
    };

    const existingDoc = {
      id: 'doc-1',
      spaceId: 'space-1',
      title: 'Operating Systems',
      author: 'Prof. Tanenbaum',
      tags: 'cs,os',
      createdAt: new Date('2026-09-01T08:00:00.000Z'),
      updatedAt: new Date('2026-09-01T08:00:00.000Z'),
      deletedAt: null,
      space: { schoolId: 'school-1' },
      versions: [],
    };

    it('allows a staff member with documents:manage to manage spaces in their school', async () => {
      mockPrisma.space.create.mockResolvedValueOnce({
        id: 'new-space-id',
        schoolId: 'school-1',
        name: 'Math Department',
        description: null,
        language: 'en',
        privacy: 'public',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.createSpace(
        { schoolId: 'school-1', name: 'Math Department' },
        staffWithDocManage,
      );
      expect(result).toBeDefined();
      expect(result.id).toBe('new-space-id');
    });

    it('denies staff with documents:manage creating spaces in another school (403)', async () => {
      await expect(
        service.createSpace(
          { schoolId: 'other-school-99', name: 'Other Space' },
          staffWithDocManage,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('denies staff without documents:manage creating spaces in their school (403)', async () => {
      await expect(
        service.createSpace(
          { schoolId: 'school-1', name: 'Unauthorized Space' },
          staffWithoutDocManage,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows staff with documents:manage to delete a document in their school', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(existingDoc);
      mockPrisma.documentVersion.count.mockResolvedValueOnce(1);
      mockPrisma.document.update.mockResolvedValueOnce({
        ...existingDoc,
        deletedAt: new Date(),
      });

      const result = await service.deleteDocument('doc-1', staffWithDocManage);
      expect(result.success).toBe(true);
    });

    it('denies staff with documents:manage deleting a document in another school (403)', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce({
        ...existingDoc,
        space: { schoolId: 'school-2' },
      });

      await expect(
        service.deleteDocument('doc-1', staffWithDocManage),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('denies staff without documents:manage deleting a document in their school (403)', async () => {
      mockPrisma.document.findUnique.mockResolvedValueOnce(existingDoc);

      await expect(
        service.deleteDocument('doc-1', staffWithoutDocManage),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
