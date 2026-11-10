import { describe, expect, it } from 'vitest';
import {
  ALLOWED_MIME_TYPES,
  detectMimeTypeFromBuffer,
  isAllowedMimeType,
} from './magic-bytes.util.js';

describe('magic-bytes.util', () => {
  describe('detectMimeTypeFromBuffer', () => {
    it('detects a valid PDF file from standard header', () => {
      const buffer = Buffer.from('%PDF-1.7\n%some binary data\n1 0 obj\n<<>>\nendobj');
      const result = detectMimeTypeFromBuffer(buffer);

      expect(result).toEqual({
        mimeType: 'application/pdf',
        extension: 'pdf',
      });
    });

    it('detects a PDF when %PDF- is preceded by a UTF-8 BOM or header preamble within 1024 bytes', () => {
      const preamble = Buffer.from('\xEF\xBB\xBF');
      const body = Buffer.from('%PDF-1.4 header');
      const buffer = Buffer.concat([preamble, body]);

      const result = detectMimeTypeFromBuffer(buffer);
      expect(result).toEqual({
        mimeType: 'application/pdf',
        extension: 'pdf',
      });
    });

    it('detects a valid JPEG image', () => {
      // JPEG starts with FF D8 FF E0
      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
      const result = detectMimeTypeFromBuffer(buffer);

      expect(result).toEqual({
        mimeType: 'image/jpeg',
        extension: 'jpg',
      });
    });

    it('detects a valid PNG image', () => {
      // PNG starts with 89 50 4E 47 0D 0A 1A 0A
      const buffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
        0x44, 0x52,
      ]);
      const result = detectMimeTypeFromBuffer(buffer);

      expect(result).toEqual({
        mimeType: 'image/png',
        extension: 'png',
      });
    });

    it('detects HEIC image with major brand "heic"', () => {
      // 4 bytes size (e.g. 24), 'ftyp', 'heic'
      const header = Buffer.alloc(24);
      header.writeUInt32BE(24, 0);
      header.write('ftyp', 4, 'latin1');
      header.write('heic', 8, 'latin1');

      const result = detectMimeTypeFromBuffer(header);
      expect(result).toEqual({
        mimeType: 'image/heic',
        extension: 'heic',
      });
    });

    it('detects HEIC image when brand is in compatible brands list (e.g. mif1)', () => {
      const header = Buffer.alloc(28);
      header.writeUInt32BE(28, 0);
      header.write('ftyp', 4, 'latin1');
      header.write('mp42', 8, 'latin1'); // generic major brand
      header.write('isom', 12, 'latin1'); // compatible 1
      header.write('mif1', 16, 'latin1'); // compatible 2 (HEIF/HEIC)

      const result = detectMimeTypeFromBuffer(header);
      expect(result).toEqual({
        mimeType: 'image/heic',
        extension: 'heic',
      });
    });

    it('rejects plain text files pretending to be PDF or image', () => {
      const textBuffer = Buffer.from('Just some plain text or markdown notes');
      expect(detectMimeTypeFromBuffer(textBuffer)).toBeNull();
    });

    it('rejects HTML files', () => {
      const htmlBuffer = Buffer.from('<!DOCTYPE html><html><body>Dangerous script</body></html>');
      expect(detectMimeTypeFromBuffer(htmlBuffer)).toBeNull();
    });

    it('rejects Windows PE executable files (MZ)', () => {
      const exeBuffer = Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff');
      expect(detectMimeTypeFromBuffer(exeBuffer)).toBeNull();
    });

    it('rejects ZIP / docx archives', () => {
      const zipBuffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
      expect(detectMimeTypeFromBuffer(zipBuffer)).toBeNull();
    });

    it('returns null for empty or tiny buffers (< 4 bytes)', () => {
      expect(detectMimeTypeFromBuffer(Buffer.alloc(0))).toBeNull();
      expect(detectMimeTypeFromBuffer(Buffer.from([0x25, 0x50]))).toBeNull();
      expect(detectMimeTypeFromBuffer(null as unknown as Buffer)).toBeNull();
    });
  });

  describe('isAllowedMimeType', () => {
    it('returns true for all allowed MIME types', () => {
      for (const mime of ALLOWED_MIME_TYPES) {
        expect(isAllowedMimeType(mime)).toBe(true);
      }
    });

    it('returns false for disallowed MIME types', () => {
      expect(isAllowedMimeType('application/zip')).toBe(false);
      expect(isAllowedMimeType('application/x-msdownload')).toBe(false);
      expect(isAllowedMimeType('text/plain')).toBe(false);
      expect(isAllowedMimeType('video/mp4')).toBe(false);
    });
  });
});

