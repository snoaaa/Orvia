import { describe, expect, it } from 'vitest';
import {
  formatContentDispositionFilename,
  parseHttpRange,
  RangeNotSatisfiableException,
} from './http-range.util.js';

describe('http-range.util', () => {
  describe('parseHttpRange', () => {
    const totalSize = 1000;

    it('returns 200 and full range when range header is undefined or empty', () => {
      expect(parseHttpRange(undefined, totalSize)).toEqual({
        start: 0,
        end: 999,
        chunkSize: 1000,
        totalSize: 1000,
        isRange: false,
        statusCode: 200,
      });

      expect(parseHttpRange('', totalSize)).toEqual({
        start: 0,
        end: 999,
        chunkSize: 1000,
        totalSize: 1000,
        isRange: false,
        statusCode: 200,
      });

      expect(parseHttpRange('   ', totalSize)).toEqual({
        start: 0,
        end: 999,
        chunkSize: 1000,
        totalSize: 1000,
        isRange: false,
        statusCode: 200,
      });
    });

    it('ignores unsupported range units and returns 200 with full content', () => {
      const result = parseHttpRange('pages=1-5', totalSize);
      expect(result.statusCode).toBe(200);
      expect(result.isRange).toBe(false);
      expect(result.chunkSize).toBe(1000);
    });

    it('parses valid closed range (bytes=0-499)', () => {
      const result = parseHttpRange('bytes=0-499', totalSize);
      expect(result).toEqual({
        start: 0,
        end: 499,
        chunkSize: 500,
        totalSize: 1000,
        isRange: true,
        statusCode: 206,
        contentRange: 'bytes 0-499/1000',
      });
    });

    it('parses valid single byte range (bytes=0-0)', () => {
      const result = parseHttpRange('bytes=0-0', totalSize);
      expect(result).toEqual({
        start: 0,
        end: 0,
        chunkSize: 1,
        totalSize: 1000,
        isRange: true,
        statusCode: 206,
        contentRange: 'bytes 0-0/1000',
      });
    });

    it('parses valid open-ended range (bytes=500-)', () => {
      const result = parseHttpRange('bytes=500-', totalSize);
      expect(result).toEqual({
        start: 500,
        end: 999,
        chunkSize: 500,
        totalSize: 1000,
        isRange: true,
        statusCode: 206,
        contentRange: 'bytes 500-999/1000',
      });
    });

    it('parses valid suffix range (bytes=-200)', () => {
      const result = parseHttpRange('bytes=-200', totalSize);
      expect(result).toEqual({
        start: 800,
        end: 999,
        chunkSize: 200,
        totalSize: 1000,
        isRange: true,
        statusCode: 206,
        contentRange: 'bytes 800-999/1000',
      });
    });

    it('clamps suffix range when suffix length exceeds total size (bytes=-5000)', () => {
      const result = parseHttpRange('bytes=-5000', totalSize);
      expect(result).toEqual({
        start: 0,
        end: 999,
        chunkSize: 1000,
        totalSize: 1000,
        isRange: true,
        statusCode: 206,
        contentRange: 'bytes 0-999/1000',
      });
    });

    it('clamps end offset if client requests beyond totalSize (bytes=900-1500)', () => {
      const result = parseHttpRange('bytes=900-1500', totalSize);
      expect(result).toEqual({
        start: 900,
        end: 999,
        chunkSize: 100,
        totalSize: 1000,
        isRange: true,
        statusCode: 206,
        contentRange: 'bytes 900-999/1000',
      });
    });

    it('takes first range when client requests multiple ranges (bytes=0-99, 200-299)', () => {
      const result = parseHttpRange('bytes=0-99, 200-299', totalSize);
      expect(result).toEqual({
        start: 0,
        end: 99,
        chunkSize: 100,
        totalSize: 1000,
        isRange: true,
        statusCode: 206,
        contentRange: 'bytes 0-99/1000',
      });
    });

    it('throws RangeNotSatisfiableException when start >= totalSize (bytes=1000-)', () => {
      expect(() => parseHttpRange('bytes=1000-', totalSize)).toThrow(RangeNotSatisfiableException);
    });

    it('throws RangeNotSatisfiableException when start > end (bytes=500-200)', () => {
      expect(() => parseHttpRange('bytes=500-200', totalSize)).toThrow(RangeNotSatisfiableException);
    });

    it('throws RangeNotSatisfiableException on missing dash (bytes=500)', () => {
      expect(() => parseHttpRange('bytes=500', totalSize)).toThrow(RangeNotSatisfiableException);
    });

    it('throws RangeNotSatisfiableException on non-numeric inputs (bytes=abc-def)', () => {
      expect(() => parseHttpRange('bytes=abc-def', totalSize)).toThrow(RangeNotSatisfiableException);
    });

    it('throws RangeNotSatisfiableException for any range on empty 0-byte file', () => {
      expect(() => parseHttpRange('bytes=0-0', 0)).toThrow(RangeNotSatisfiableException);
    });

    it('handles 0-byte file without range header gracefully', () => {
      const result = parseHttpRange(undefined, 0);
      expect(result).toEqual({
        start: 0,
        end: 0,
        chunkSize: 0,
        totalSize: 0,
        isRange: false,
        statusCode: 200,
      });
    });
  });

  describe('formatContentDispositionFilename', () => {
    it('formats clean ASCII filenames directly', () => {
      const result = formatContentDispositionFilename('document-v1.pdf');
      expect(result.ascii).toBe('document-v1.pdf');
      expect(result.utf8).toBe('document-v1.pdf');
    });

    it('sanitizes quotes and backslashes in ASCII fallback', () => {
      const result = formatContentDispositionFilename('lecture "final"\\exam.pdf');
      expect(result.ascii).toBe('lecture _final__exam.pdf');
      expect(result.utf8).toContain('%22final%22');
    });

    it('encodes UTF-8 accents and unicode characters', () => {
      const result = formatContentDispositionFilename('Cours de Mathématiques 2026.pdf');
      expect(result.ascii).toBe('Cours de Math_matiques 2026.pdf');
      expect(result.utf8).toBe('Cours%20de%20Math%C3%A9matiques%202026.pdf');
    });

    it('falls back to default download for empty filenames', () => {
      const result = formatContentDispositionFilename('');
      expect(result.ascii).toBe('download');
      expect(result.utf8).toBe('download');
    });
  });
});
