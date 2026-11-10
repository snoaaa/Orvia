import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { DocumentsController } from './documents.controller.js';
import { ValidatedFileEntity } from '../entities/validated-file.entity.js';
import type { UploadedFile } from '../interfaces/index.js';
import type { DocumentsService } from '../services/documents.service.js';
import { RangeNotSatisfiableException } from '../utils/http-range.util.js';

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
      uploadImage: vi.fn(),
      getDocumentVersionStream: vi.fn(),
      replaceDocumentVersion: vi.fn(),
      listDocumentVersions: vi.fn(),
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

  describe('updateDocument', () => {
    it('delegates to documentsService.updateDocument with auditContext', async () => {
      const dto = {
        title: 'Updated Operating Systems Notes',
        author: 'Prof. Tanenbaum',
        tags: 'os,systems',
        date: '2026-10-15T09:00:00.000Z',
      };

      const expectedDoc = {
        id: 'doc-1',
        title: 'Updated Operating Systems Notes',
        author: 'Prof. Tanenbaum',
        tags: 'os,systems',
      } as any;

      mockDocumentsService.updateDocument.mockResolvedValueOnce(expectedDoc);

      const mockReq = {
        ip: '127.0.0.1',
        header: vi.fn().mockReturnValue(undefined),
      } as any;

      const res = await controller.updateDocument('doc-1', dto, mockReq, mockActor);

      expect(mockDocumentsService.updateDocument).toHaveBeenCalledWith(
        'doc-1',
        dto,
        mockActor,
        expect.objectContaining({
          ip: '127.0.0.1',
        }),
      );
      expect(res).toBe(expectedDoc);
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

      const mockReq = {
        ip: '127.0.0.1',
        header: vi.fn().mockReturnValue(undefined),
      } as any;

      const result = await controller.uploadPdf('space-1', mockFile, dto, mockActor, mockReq);

      expect(mockDocumentsService.uploadPdf).toHaveBeenCalledWith(
        'space-1',
        mockFile,
        dto,
        mockActor,
        expect.objectContaining({ ip: '127.0.0.1' }),
      );
      expect(result).toBe(expectedDoc);
    });
  });

  describe('uploadImage', () => {
    it('delegates image upload to documentsService.uploadImage', async () => {
      const mockFile = {
        buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        originalname: 'whiteboard.jpg',
        mimetype: 'image/jpeg',
      } as UploadedFile;

      const dto = {
        title: 'Whiteboard',
        author: 'Lecturer',
        tags: 'math',
      };

      const expectedDoc = {
        id: 'doc-456',
        spaceId: 'space-1',
        title: 'Whiteboard',
        currentVersion: {
          versionNo: 1,
          status: 'pending',
          mimeType: 'image/jpeg',
        },
      } as any;

      mockDocumentsService.uploadImage.mockResolvedValueOnce(expectedDoc);

      const mockReq = {
        ip: '127.0.0.1',
        header: vi.fn().mockReturnValue(undefined),
      } as any;

      const result = await controller.uploadImage('space-1', mockFile, dto, mockActor, mockReq);

      expect(mockDocumentsService.uploadImage).toHaveBeenCalledWith(
        'space-1',
        mockFile,
        dto,
        mockActor,
        expect.objectContaining({ ip: '127.0.0.1' }),
      );
      expect(result).toBe(expectedDoc);
    });
  });

  describe('replaceDocument and createDocumentVersion', () => {
    it('replaceDocument delegates to documentsService.replaceDocumentVersion', async () => {
      const mockFile = {
        buffer: Buffer.from('%PDF-1.4\nreplacement content'),
        originalname: 'replacement.pdf',
        mimetype: 'application/pdf',
      } as UploadedFile;

      const expectedDoc = {
        id: 'doc-1',
        title: 'Document',
        currentVersion: { versionNo: 2, status: 'pending' },
      } as any;

      mockDocumentsService.replaceDocumentVersion.mockResolvedValueOnce(expectedDoc);

      const mockReq = {
        ip: '127.0.0.1',
        header: vi.fn().mockReturnValue(undefined),
      } as any;

      const res = await controller.replaceDocument('doc-1', mockFile, mockReq, mockActor);

      expect(mockDocumentsService.replaceDocumentVersion).toHaveBeenCalledWith(
        'doc-1',
        mockFile,
        mockActor,
        expect.objectContaining({ ip: '127.0.0.1' }),
      );
      expect(res).toBe(expectedDoc);
    });

    it('createDocumentVersion is an alias and delegates to replaceDocumentVersion', async () => {
      const mockFile = {
        buffer: Buffer.from('%PDF-1.4\ncontent'),
        originalname: 'v2.pdf',
        mimetype: 'application/pdf',
      } as UploadedFile;

      const expectedDoc = {
        id: 'doc-1',
        title: 'Document',
        currentVersion: { versionNo: 2, status: 'pending' },
      } as any;

      mockDocumentsService.replaceDocumentVersion.mockResolvedValueOnce(expectedDoc);

      const mockReq = {
        ip: '127.0.0.1',
        header: vi.fn().mockReturnValue(undefined),
      } as any;

      const res = await controller.createDocumentVersion('doc-1', mockFile, mockReq, mockActor);

      expect(mockDocumentsService.replaceDocumentVersion).toHaveBeenCalledWith(
        'doc-1',
        mockFile,
        mockActor,
        expect.objectContaining({ ip: '127.0.0.1' }),
      );
      expect(res).toBe(expectedDoc);
    });
  });

  describe('listDocumentVersions', () => {
    it('delegates to documentsService.listDocumentVersions', async () => {
      const mockVersions = [
        {
          id: 'ver-2',
          documentId: 'doc-1',
          versionNumber: 2,
          versionNo: 2,
          date: new Date('2026-10-20T10:00:00Z'),
          createdAt: new Date('2026-10-20T10:00:00Z'),
          uploader: { id: 'usr-1', name: 'Admin', email: 'admin@school.org' },
          size: 2048,
          checksum: 'abc2',
          status: 'pending',
          mimeType: 'application/pdf',
          storageKey: 'spaces/space-1/docs/doc-1/v2.pdf',
          pageCount: 0,
          isCurrent: true,
        },
        {
          id: 'ver-1',
          documentId: 'doc-1',
          versionNumber: 1,
          versionNo: 1,
          date: new Date('2026-10-10T10:00:00Z'),
          createdAt: new Date('2026-10-10T10:00:00Z'),
          uploader: { id: 'usr-1', name: 'Admin', email: 'admin@school.org' },
          size: 1024,
          checksum: 'abc1',
          status: 'indexed',
          mimeType: 'application/pdf',
          storageKey: 'spaces/space-1/docs/doc-1/v1.pdf',
          pageCount: 5,
          isCurrent: false,
        },
      ];

      mockDocumentsService.listDocumentVersions.mockResolvedValueOnce(mockVersions);

      const result = await controller.listDocumentVersions('doc-1', mockActor);

      expect(mockDocumentsService.listDocumentVersions).toHaveBeenCalledWith('doc-1', mockActor);
      expect(result).toBe(mockVersions);
    });
  });

  describe('download and stream endpoints', () => {
    const createMockResponse = () => {
      const res: any = {
        statusCode: 200,
        headers: {} as Record<string, string>,
        status: vi.fn().mockImplementation((code) => {
          res.statusCode = code;
          return res;
        }),
        setHeader: vi.fn().mockImplementation((k, v) => {
          res.headers[k] = v;
          return res;
        }),
        json: vi.fn().mockImplementation((body) => {
          res.body = body;
          return res;
        }),
        on: vi.fn(),
      };
      return res;
    };

    const mockStream = {
      pipe: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn(),
    } as any;

    it('downloadCurrentDocument streams with attachment disposition', async () => {
      const res = createMockResponse();
      const req = { headers: {} } as any;

      mockDocumentsService.getDocumentVersionStream.mockResolvedValueOnce({
        stream: mockStream,
        statusCode: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': 1000,
          'Content-Disposition': 'attachment; filename="doc.pdf"',
        },
      });

      await controller.downloadCurrentDocument('doc-1', undefined, req, res, mockActor);

      expect(mockDocumentsService.getDocumentVersionStream).toHaveBeenCalledWith({
        documentId: 'doc-1',
        versionRef: 'latest',
        actor: mockActor,
        rangeHeader: undefined,
        disposition: 'attachment',
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(mockStream.pipe).toHaveBeenCalledWith(res);
    });

    it('streamCurrentDocument streams with inline disposition', async () => {
      const res = createMockResponse();
      const req = { headers: { range: 'bytes=0-499' } } as any;

      mockDocumentsService.getDocumentVersionStream.mockResolvedValueOnce({
        stream: mockStream,
        statusCode: 206,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': 500,
          'Content-Range': 'bytes 0-499/1000',
          'Content-Disposition': 'inline; filename="doc.pdf"',
        },
      });

      await controller.streamCurrentDocument('doc-1', req, res, mockActor);

      expect(mockDocumentsService.getDocumentVersionStream).toHaveBeenCalledWith({
        documentId: 'doc-1',
        versionRef: 'latest',
        actor: mockActor,
        rangeHeader: 'bytes=0-499',
        disposition: 'inline',
      });
      expect(res.status).toHaveBeenCalledWith(206);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Range', 'bytes 0-499/1000');
    });

    it('downloadDocumentVersion streams specific version with attachment', async () => {
      const res = createMockResponse();
      const req = { headers: {} } as any;

      mockDocumentsService.getDocumentVersionStream.mockResolvedValueOnce({
        stream: mockStream,
        statusCode: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': 800,
          'Content-Disposition': 'attachment; filename="doc.pdf"',
        },
      });

      await controller.downloadDocumentVersion('doc-1', '2', undefined, req, res, mockActor);

      expect(mockDocumentsService.getDocumentVersionStream).toHaveBeenCalledWith({
        documentId: 'doc-1',
        versionRef: '2',
        actor: mockActor,
        rangeHeader: undefined,
        disposition: 'attachment',
      });
    });

    it('streamDocumentVersion streams specific version with inline disposition', async () => {
      const res = createMockResponse();
      const req = { headers: {} } as any;

      mockDocumentsService.getDocumentVersionStream.mockResolvedValueOnce({
        stream: mockStream,
        statusCode: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline; filename="doc.pdf"',
        },
      });

      await controller.streamDocumentVersion('doc-1', 'ver-uuid-123', req, res, mockActor);

      expect(mockDocumentsService.getDocumentVersionStream).toHaveBeenCalledWith({
        documentId: 'doc-1',
        versionRef: 'ver-uuid-123',
        actor: mockActor,
        rangeHeader: undefined,
        disposition: 'inline',
      });
    });

    it('catches RangeNotSatisfiableException and returns 416 with Content-Range header', async () => {
      const res = createMockResponse();
      const req = { headers: { range: 'bytes=9999-' } } as any;

      mockDocumentsService.getDocumentVersionStream.mockRejectedValueOnce(
        new RangeNotSatisfiableException(1000),
      );

      await controller.streamDocumentVersion('doc-1', '1', req, res, mockActor);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Range', 'bytes */1000');
      expect(res.status).toHaveBeenCalledWith(416);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 416,
          message: 'Requested range not satisfiable',
        }),
      );
    });
  });
});
