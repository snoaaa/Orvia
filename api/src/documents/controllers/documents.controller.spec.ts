import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { DocumentsController } from './documents.controller.js';
import { ValidatedFileEntity } from '../entities/validated-file.entity.js';
import type { UploadedFile } from '../interfaces/index.js';
import type { DocumentsService } from '../services/documents.service.js';

describe('DocumentsController', () => {
  let controller: DocumentsController;
  let mockDocumentsService: any;

  const mockActor: AuthenticatedUser = {
    id: 'user-1',
    sessionId: 'session-1',
    email: 'user@example.com',
    fullName: 'Test User',
    status: 'ACTIVE',
    assignments: [
      {
        role: 'school_admin',
        scope: 'school',
        schoolId: 'school-1',
        groupId: null,
        permissions: ['documents:create', 'documents:read'],
      },
    ],
    permissions: ['documents:create', 'documents:read'],
    schoolIds: ['school-1'],
    isPlatformAdmin: false,
    role: 'school_admin',
    schoolId: 'school-1',
  };

  beforeEach(() => {
    mockDocumentsService = {
      findAllDocuments: vi.fn(),
      findDocumentById: vi.fn(),
      createDocument: vi.fn(),
      updateDocument: vi.fn(),
      findAllSpaces: vi.fn(),
      createSpace: vi.fn(),
      validateUploadedFile: vi.fn(),
      uploadPdf: vi.fn(),
    };

    controller = new DocumentsController(mockDocumentsService as unknown as DocumentsService);
  });

  describe('validateFile', () => {
    it('delegates file validation to documentsService.validateUploadedFile', async () => {
      const mockFile = {
        buffer: Buffer.from('%PDF-1.4\ncontent'),
        originalname: 'paper.pdf',
        mimetype: 'application/pdf',
      } as UploadedFile;

      const expectedEntity = new ValidatedFileEntity({
        valid: true,
        checksum: 'abc123checksum',
        mimeType: 'application/pdf',
        extension: 'pdf',
        size: 2048,
      });

      mockDocumentsService.validateUploadedFile.mockResolvedValueOnce(expectedEntity);

      const result = await controller.validateFile('space-123', mockFile, mockActor);

      expect(mockDocumentsService.validateUploadedFile).toHaveBeenCalledWith(
        'space-123',
        mockFile,
        mockActor,
      );
      expect(result).toBe(expectedEntity);
      expect(result.valid).toBe(true);
      expect(result.checksum).toBe('abc123checksum');
    });
  });

  describe('getDocuments', () => {
    it('delegates to findAllDocuments', async () => {
      const query = { page: 1, limit: 10 };
      mockDocumentsService.findAllDocuments.mockResolvedValueOnce({
        data: [],
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 1,
      });

      const res = await controller.getDocuments(query, mockActor);
      expect(mockDocumentsService.findAllDocuments).toHaveBeenCalledWith(mockActor, query);
      expect(res.total).toBe(0);
    });
  });

  describe('getDocumentById', () => {
    it('delegates to findDocumentById', async () => {
      mockDocumentsService.findDocumentById.mockResolvedValueOnce({
        id: 'doc-1',
        title: 'Title',
      });

      const res = await controller.getDocumentById('doc-1', mockActor);
      expect(mockDocumentsService.findDocumentById).toHaveBeenCalledWith('doc-1', mockActor);
      expect(res.id).toBe('doc-1');
    });
  });

  describe('uploadPdf', () => {
    it('delegates PDF upload to documentsService.uploadPdf', async () => {
      const mockFile = {
        buffer: Buffer.from('%PDF-1.4\ncontent'),
        originalname: 'lecture.pdf',
        mimetype: 'application/pdf',
      } as UploadedFile;

      const dto = {
        title: 'Lecture 1',
        author: 'Prof',
        tags: 'math',
      };

      const expectedDoc = {
        id: 'doc-123',
        spaceId: 'space-1',
        title: 'Lecture 1',
        currentVersion: {
          versionNo: 1,
          status: 'pending',
        },
      } as any;

      mockDocumentsService.uploadPdf.mockResolvedValueOnce(expectedDoc);

      const result = await controller.uploadPdf('space-1', mockFile, dto, mockActor);

      expect(mockDocumentsService.uploadPdf).toHaveBeenCalledWith(
        'space-1',
        mockFile,
        dto,
        mockActor,
      );
      expect(result).toBe(expectedDoc);
    });
  });
});
