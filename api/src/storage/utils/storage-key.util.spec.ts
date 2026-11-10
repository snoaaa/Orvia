import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { buildDocumentStorageKey, sanitizeStorageKey } from './storage-key.util.js';

describe('StorageKeyUtil (#101)', () => {
  describe('sanitizeStorageKey', () => {
    it('normalizes forward and backward slashes and removes leading slashes', () => {
      expect(sanitizeStorageKey('spaces\\123\\docs\\file.pdf')).toBe('spaces/123/docs/file.pdf');
      expect(sanitizeStorageKey('/spaces/123/docs/file.pdf')).toBe('spaces/123/docs/file.pdf');
      expect(sanitizeStorageKey('///spaces/123/docs/file.pdf')).toBe('spaces/123/docs/file.pdf');
    });

    it('rejects empty or whitespace-only keys with BadRequestException', () => {
      expect(() => sanitizeStorageKey('')).toThrow(BadRequestException);
      expect(() => sanitizeStorageKey('   ')).toThrow(BadRequestException);
      expect(() => sanitizeStorageKey('/  ')).toThrow(BadRequestException);
    });

    it('rejects path traversal attempts with BadRequestException', () => {
      expect(() => sanitizeStorageKey('../secret.txt')).toThrow(BadRequestException);
      expect(() => sanitizeStorageKey('spaces/../../secret.txt')).toThrow(BadRequestException);
      expect(() => sanitizeStorageKey('spaces/./file.pdf')).toThrow(BadRequestException);
      expect(() => sanitizeStorageKey('..')).toThrow(BadRequestException);
    });

    it('rejects null bytes and drive letters with BadRequestException', () => {
      expect(() => sanitizeStorageKey('spaces/file\0.pdf')).toThrow(BadRequestException);
      expect(() => sanitizeStorageKey('C:/Windows/System32')).toThrow(BadRequestException);
      expect(() => sanitizeStorageKey('D:\\secret')).toThrow(BadRequestException);
    });
  });

  describe('buildDocumentStorageKey', () => {
    it('generates standard relative document storage key per Spec §5.2', () => {
      const key = buildDocumentStorageKey({
        spaceId: 'space-uuid-1',
        documentId: 'doc-uuid-2',
        version: 1,
        extension: 'pdf',
      });

      expect(key).toBe('spaces/space-uuid-1/docs/doc-uuid-2/v1.pdf');
    });

    it('cleans extensions with leading dots and trims casing', () => {
      const key = buildDocumentStorageKey({
        spaceId: 'space-uuid-1',
        documentId: 'doc-uuid-2',
        version: 3,
        extension: '.PDF',
      });

      expect(key).toBe('spaces/space-uuid-1/docs/doc-uuid-2/v3.pdf');
    });

    it('handles documents without an extension', () => {
      const key = buildDocumentStorageKey({
        spaceId: 'space-uuid-1',
        documentId: 'doc-uuid-2',
        version: 2,
      });

      expect(key).toBe('spaces/space-uuid-1/docs/doc-uuid-2/v2');
    });

    it('rejects missing or invalid spaceId, documentId, or version', () => {
      expect(() =>
        buildDocumentStorageKey({
          spaceId: '',
          documentId: 'doc-1',
          version: 1,
        }),
      ).toThrow(BadRequestException);

      expect(() =>
        buildDocumentStorageKey({
          spaceId: 'space-1',
          documentId: '',
          version: 1,
        }),
      ).toThrow(BadRequestException);

      expect(() =>
        buildDocumentStorageKey({
          spaceId: 'space-1',
          documentId: 'doc-1',
          version: 0,
        }),
      ).toThrow(BadRequestException);

      expect(() =>
        buildDocumentStorageKey({
          spaceId: 'space-1',
          documentId: 'doc-1',
          version: 1.5,
        }),
      ).toThrow(BadRequestException);
    });
  });
});

