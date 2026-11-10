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
      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
      const result = detectMimeTypeFromBuffer(buffer);

      expect(result).toEqual({
        mimeType: 'image/jpeg',
        extension: 'jpg',
      });
    });

    it('detects a valid PNG image', () => {
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

    it('detects Microsoft Word (DOCX) via deep OpenXML container inspection', () => {
      const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
      const openXmlBody = Buffer.from('[Content_Types].xml...word/document.xml...word/_rels');
      const docxBuffer = Buffer.concat([zipHeader, openXmlBody]);

      const result = detectMimeTypeFromBuffer(docxBuffer, 'syllabus.docx');
      expect(result).toEqual({
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        extension: 'docx',
      });
    });

    it('detects Microsoft PowerPoint (PPTX) via deep OpenXML container inspection', () => {
      const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
      const openXmlBody = Buffer.from('[Content_Types].xml...ppt/presentation.xml...ppt/slides');
      const pptxBuffer = Buffer.concat([zipHeader, openXmlBody]);

      const result = detectMimeTypeFromBuffer(pptxBuffer, 'lecture-01.pptx');
      expect(result).toEqual({
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        extension: 'pptx',
      });
    });

    it('detects Microsoft Excel (XLSX) via deep OpenXML container inspection', () => {
      const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
      const openXmlBody = Buffer.from('[Content_Types].xml...xl/workbook.xml...xl/worksheets');
      const xlsxBuffer = Buffer.concat([zipHeader, openXmlBody]);

      const result = detectMimeTypeFromBuffer(xlsxBuffer, 'grades.xlsx');
      expect(result).toEqual({
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        extension: 'xlsx',
      });
    });

    it('detects OpenDocument Text (ODT)', () => {
      const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
      const odtBody = Buffer.from('mimetypeapplication/vnd.oasis.opendocument.text...content.xml');
      const odtBuffer = Buffer.concat([zipHeader, odtBody]);

      const result = detectMimeTypeFromBuffer(odtBuffer, 'notes.odt');
      expect(result).toEqual({
        mimeType: 'application/vnd.oasis.opendocument.text',
        extension: 'odt',
      });
    });

    it('refuses generic or malicious ZIP archives lacking valid Office structures', () => {
      const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
      const genericZipBody = Buffer.from('payload.exe...script.sh...something-else');
      const fakeDocx = Buffer.concat([zipHeader, genericZipBody]);

      // Even if attacker names it .docx, deep inspection rejects it!
      const result = detectMimeTypeFromBuffer(fakeDocx, 'malicious.docx');
      expect(result).toBeNull();
    });

    it('detects Legacy Microsoft Word (DOC) via OLE2 signature', () => {
      const ole2Header = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
      const docBody = Buffer.from('WordDocument structure stream payload');
      const docBuffer = Buffer.concat([ole2Header, docBody]);

      const result = detectMimeTypeFromBuffer(docBuffer, 'assignment.doc');
      expect(result).toEqual({
        mimeType: 'application/msword',
        extension: 'doc',
      });
    });

    it('detects Legacy Microsoft Excel (XLS) via OLE2 signature', () => {
      const ole2Header = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
      const xlsBody = Buffer.from('Workbook stream payload in compound file');
      const xlsBuffer = Buffer.concat([ole2Header, xlsBody]);

      const result = detectMimeTypeFromBuffer(xlsBuffer, 'data.xls');
      expect(result).toEqual({
        mimeType: 'application/vnd.ms-excel',
        extension: 'xls',
      });
    });

    it('detects Legacy Microsoft PowerPoint (PPT) via OLE2 signature', () => {
      const ole2Header = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
      const pptBody = Buffer.from('PowerPoint Document stream payload');
      const pptBuffer = Buffer.concat([ole2Header, pptBody]);

      const result = detectMimeTypeFromBuffer(pptBuffer, 'slides.ppt');
      expect(result).toEqual({
        mimeType: 'application/vnd.ms-powerpoint',
        extension: 'ppt',
      });
    });

    it('detects Plain Text (.txt) with valid UTF-8 and no null bytes', () => {
      const textBuffer = Buffer.from('This is a plain text document for lecture 1.');
      const result = detectMimeTypeFromBuffer(textBuffer, 'reading-list.txt');

      expect(result).toEqual({
        mimeType: 'text/plain',
        extension: 'txt',
      });
    });

    it('detects Markdown (.md) with valid UTF-8 and no null bytes', () => {
      const mdBuffer = Buffer.from('# Course Overview\n\n- Chapter 1: Foundations\n- Chapter 2: Deep Learning');
      const result = detectMimeTypeFromBuffer(mdBuffer, 'syllabus.md');

      expect(result).toEqual({
        mimeType: 'text/markdown',
        extension: 'md',
      });
    });

    it('detects CSV (.csv) data files', () => {
      const csvBuffer = Buffer.from('id,student_name,score\n1,Alice,95\n2,Bob,88');
      const result = detectMimeTypeFromBuffer(csvBuffer, 'grades.csv');

      expect(result).toEqual({
        mimeType: 'text/csv',
        extension: 'csv',
      });
    });

    it('rejects text containing binary null bytes', () => {
      const binaryInText = Buffer.from('Normal text header\x00corrupt binary bytes\x00');
      const result = detectMimeTypeFromBuffer(binaryInText, 'fake.txt');

      expect(result).toBeNull();
    });

    it('rejects scripts or executables (.sh, .bat, .exe) even if text-encoded', () => {
      const scriptBuffer = Buffer.from('#!/bin/bash\nrm -rf /');
      const result = detectMimeTypeFromBuffer(scriptBuffer, 'exploit.sh');

      expect(result).toBeNull();
    });

    it('rejects Windows PE executable files (MZ)', () => {
      const exeBuffer = Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff');
      expect(detectMimeTypeFromBuffer(exeBuffer)).toBeNull();
    });

    it('returns null for empty or tiny buffers (< 4 bytes)', () => {
      expect(detectMimeTypeFromBuffer(Buffer.alloc(0))).toBeNull();
      expect(detectMimeTypeFromBuffer(Buffer.from([0x25, 0x50]))).toBeNull();
      expect(detectMimeTypeFromBuffer(null as unknown as Buffer)).toBeNull();
    });
  });

  describe('isAllowedMimeType', () => {
    it('returns true for all enterprise allowed MIME types', () => {
      for (const mime of ALLOWED_MIME_TYPES) {
        expect(isAllowedMimeType(mime)).toBe(true);
      }
    });

    it('returns false for disallowed MIME types', () => {
      expect(isAllowedMimeType('application/zip')).toBe(false);
      expect(isAllowedMimeType('application/x-msdownload')).toBe(false);
      expect(isAllowedMimeType('application/x-sh')).toBe(false);
      expect(isAllowedMimeType('video/mp4')).toBe(false);
    });
  });
});
