import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { UploadedFile } from '../interfaces/index.js';
import { DocumentsService } from './documents.service.js';
import type { FileValidationService } from './file-validation.service.js';

describe('DocumentsService', () => {
  let service: DocumentsService;
  let mockPrisma: any;
  let mockFileValidationService: any;

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
      },
    };

    mockFileValidationService = {
      validateFile: vi.fn(),
    };

    service = new DocumentsService(
      mockPrisma as unknown as PrismaService,
      mockFileValidationService as unknown as FileValidationService,
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
});
