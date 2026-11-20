import { HttpStatus, HttpException } from '@nestjs/common';

export class RangeNotSatisfiableException extends HttpException {
  readonly totalSize: number;

  constructor(totalSize: number) {
    super(
      {
        statusCode: HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
        message: 'Requested range not satisfiable',
        error: 'Range Not Satisfiable',
      },
      HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
    );
    this.totalSize = totalSize;
  }
}

export interface ParsedHttpRange {
  start: number;
  end: number;
  chunkSize: number;
  totalSize: number;
  isRange: boolean;
  statusCode: 200 | 206;
  contentRange?: string;
}

/**
 * Parses and validates an HTTP Range header (RFC 7233 / RFC 9110) for byte-range streaming (§4.3, §7, #104).
 *
 * Supported formats:
 * - `bytes=0-499` (first 500 bytes)
 * - `bytes=500-` (from byte 500 through end of file)
 * - `bytes=-500` (suffix: final 500 bytes of file)
 * - If multiple ranges are passed (e.g. `bytes=0-50, 100-150`), takes the first valid range.
 *
 * Returns 200 with full range if header is absent or uses an unsupported unit.
 * Throws `RangeNotSatisfiableException` (HTTP 416) if range boundaries are unsatisfiable.
 */
export function parseHttpRange(rangeHeader: string | undefined | null, totalSize: number): ParsedHttpRange {
  // If no range header is present, serve the complete resource with HTTP 200
  if (!rangeHeader || typeof rangeHeader !== 'string' || rangeHeader.trim().length === 0) {
    const end = totalSize > 0 ? totalSize - 1 : 0;
    return {
      start: 0,
      end,
      chunkSize: totalSize,
      totalSize,
      isRange: false,
      statusCode: 200,
    };
  }

  const trimmed = rangeHeader.trim();

  // RFC 7233 §3.1: An origin server MUST ignore a Range header field that contains a range unit it does not understand
  if (!trimmed.startsWith('bytes=')) {
    const end = totalSize > 0 ? totalSize - 1 : 0;
    return {
      start: 0,
      end,
      chunkSize: totalSize,
      totalSize,
      isRange: false,
      statusCode: 200,
    };
  }

  // Extract the range specifier (take the first range if comma-separated multipart)
  const rangeSpec = trimmed.slice(6).split(',')[0].trim();
  const dashIndex = rangeSpec.indexOf('-');

  if (dashIndex === -1) {
    throw new RangeNotSatisfiableException(totalSize);
  }

  const startPart = rangeSpec.slice(0, dashIndex).trim();
  const endPart = rangeSpec.slice(dashIndex + 1).trim();

  // Any range on a 0-byte file cannot satisfy byte offsets
  if (totalSize === 0) {
    throw new RangeNotSatisfiableException(0);
  }

  let start: number;
  let end: number;

  if (startPart.length === 0) {
    // Suffix range: bytes=-500 (final N bytes)
    const suffixLength = parseInt(endPart, 10);
    if (isNaN(suffixLength) || suffixLength <= 0) {
      throw new RangeNotSatisfiableException(totalSize);
    }
    start = Math.max(0, totalSize - suffixLength);
    end = totalSize - 1;
  } else if (endPart.length === 0) {
    // Open-ended range: bytes=500- (from offset 500 to end)
    start = parseInt(startPart, 10);
    if (isNaN(start) || start < 0 || start >= totalSize) {
      throw new RangeNotSatisfiableException(totalSize);
    }
    end = totalSize - 1;
  } else {
    // Closed range: bytes=0-499
    start = parseInt(startPart, 10);
    end = parseInt(endPart, 10);
    if (isNaN(start) || isNaN(end) || start < 0 || start > end || start >= totalSize) {
      throw new RangeNotSatisfiableException(totalSize);
    }
    end = Math.min(end, totalSize - 1);
  }

  const chunkSize = end - start + 1;

  return {
    start,
    end,
    chunkSize,
    totalSize,
    isRange: true,
    statusCode: 206,
    contentRange: `bytes ${start}-${end}/${totalSize}`,
  };
}

/**
 * Sanitizes a filename for Content-Disposition per RFC 5987 / RFC 6266.
 * Returns an ASCII fallback and an encoded UTF-8 filename.
 */
export function formatContentDispositionFilename(filename: string): { ascii: string; utf8: string } {
  const clean = filename.replace(/[\r\n\0]/g, '').trim();
  const ascii = clean.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  const utf8 = encodeURIComponent(clean);
  return {
    ascii: ascii || 'download',
    utf8: utf8 || 'download',
  };
}
