export type AllowedMimeType =
  // PDF
  | 'application/pdf'
  // Images
  | 'image/jpeg'
  | 'image/png'
  | 'image/heic'
  | 'image/heif'
  // Microsoft Office (OpenXML)
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  // Legacy Microsoft Office (OLE2 / Binary)
  | 'application/msword'
  | 'application/vnd.ms-powerpoint'
  | 'application/vnd.ms-excel'
  // OpenDocument
  | 'application/vnd.oasis.opendocument.text'
  | 'application/vnd.oasis.opendocument.spreadsheet'
  | 'application/vnd.oasis.opendocument.presentation'
  // Text & Tabular Data
  | 'text/plain'
  | 'text/markdown'
  | 'text/csv';

export type AllowedFileExtension =
  | 'pdf'
  | 'jpg'
  | 'jpeg'
  | 'png'
  | 'heic'
  | 'heif'
  | 'docx'
  | 'pptx'
  | 'xlsx'
  | 'doc'
  | 'ppt'
  | 'xls'
  | 'odt'
  | 'ods'
  | 'odp'
  | 'txt'
  | 'md'
  | 'csv';

export interface DetectedFileType {
  mimeType: AllowedMimeType;
  extension: AllowedFileExtension;
}

export const ALLOWED_MIME_TYPES: readonly AllowedMimeType[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.ms-powerpoint',
  'application/vnd.ms-excel',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'text/plain',
  'text/markdown',
  'text/csv',
] as const;

const PDF_MAGIC = Buffer.from('%PDF-'); // 0x25, 0x50, 0x44, 0x46, 0x2D
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const FTYP_BOX = Buffer.from('ftyp'); // 0x66, 0x74, 0x79, 0x70
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04
const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // Compound File Binary

const HEIC_BRANDS = new Set([
  'heic',
  'heix',
  'heim',
  'heis',
  'mif1',
  'msf1',
  'hevc',
  'hevx',
]);

/**
 * Checks if a MIME type string is one of the allowed ingestion types.
 */
export function isAllowedMimeType(mime: string): mime is AllowedMimeType {
  return ALLOWED_MIME_TYPES.includes(mime as AllowedMimeType);
}

/**
 * Detects the file format and MIME type strictly from the file content's magic bytes
 * and internal structure (§4.1, §5.2 Ingestion, #100, #150).
 *
 * Supported formats:
 * - PDF (`application/pdf`)
 * - Images (`image/jpeg`, `image/png`, `image/heic`, `image/heif`)
 * - Office OpenXML (`.docx`, `.pptx`, `.xlsx`) via deep ZIP structure inspection
 * - Legacy Office OLE2 (`.doc`, `.ppt`, `.xls`)
 * - OpenDocument (`.odt`, `.ods`, `.odp`)
 * - Plain Text, Markdown, and CSV (`.txt`, `.md`, `.csv`)
 *
 * Returns null if the buffer does not match any allowed format or contains disallowed binary structures.
 */
export function detectMimeTypeFromBuffer(buffer: Buffer, originalName?: string): DetectedFileType | null {
  if (!buffer || buffer.length < 4) {
    return null;
  }

  // 1. Check PNG (8 bytes)
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_MAGIC)) {
    return { mimeType: 'image/png', extension: 'png' };
  }

  // 2. Check JPEG (starts with FF D8 FF)
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(JPEG_MAGIC)) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }

  // 3. Check PDF (%PDF- at start, or within first 1024 bytes per ISO 32000-1)
  const pdfHeaderLimit = Math.min(buffer.length, 1024);
  const pdfIndex = buffer.subarray(0, pdfHeaderLimit).indexOf(PDF_MAGIC);
  if (pdfIndex !== -1) {
    return { mimeType: 'application/pdf', extension: 'pdf' };
  }

  // 4. Check HEIC / HEIF (ISOBMFF container with 'ftyp' box)
  if (buffer.length >= 12) {
    const boxType = buffer.subarray(4, 8);
    if (boxType.equals(FTYP_BOX)) {
      const boxSize = buffer.readUInt32BE(0);
      const majorBrand = buffer.subarray(8, 12).toString('latin1').toLowerCase().trim();
      if (HEIC_BRANDS.has(majorBrand)) {
        return { mimeType: 'image/heic', extension: 'heic' };
      }

      const scanLimit = Math.min(boxSize > 0 ? boxSize : buffer.length, buffer.length, 64);
      for (let offset = 12; offset + 4 <= scanLimit; offset += 4) {
        const brand = buffer.subarray(offset, offset + 4).toString('latin1').toLowerCase().trim();
        if (HEIC_BRANDS.has(brand)) {
          return { mimeType: 'image/heic', extension: 'heic' };
        }
      }
    }
  }

  // 5. Check ZIP Containers (DOCX, PPTX, XLSX, ODT, ODS, ODP)
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(ZIP_MAGIC)) {
    // Deep inspection: verify inner OpenXML or OpenDocument structure
    // Prevents arbitrary or malicious .zip archives from masquerading as documents.
    if (buffer.includes('word/')) {
      return {
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        extension: 'docx',
      };
    }

    if (buffer.includes('ppt/')) {
      return {
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        extension: 'pptx',
      };
    }

    if (buffer.includes('xl/')) {
      return {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        extension: 'xlsx',
      };
    }

    if (buffer.includes('mimetypeapplication/vnd.oasis.opendocument.text')) {
      return {
        mimeType: 'application/vnd.oasis.opendocument.text',
        extension: 'odt',
      };
    }

    if (buffer.includes('mimetypeapplication/vnd.oasis.opendocument.spreadsheet')) {
      return {
        mimeType: 'application/vnd.oasis.opendocument.spreadsheet',
        extension: 'ods',
      };
    }

    if (buffer.includes('mimetypeapplication/vnd.oasis.opendocument.presentation')) {
      return {
        mimeType: 'application/vnd.oasis.opendocument.presentation',
        extension: 'odp',
      };
    }

    // Generic unverified ZIP archive: refuse
    return null;
  }

  // 6. Check Legacy Microsoft Office (OLE2 / Compound File Binary Format)
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(OLE2_MAGIC)) {
    const isWord =
      buffer.includes(Buffer.from('WordDocument', 'utf16le')) ||
      buffer.includes(Buffer.from('WordDocument', 'latin1'));
    if (isWord) {
      return { mimeType: 'application/msword', extension: 'doc' };
    }

    const isPpt =
      buffer.includes(Buffer.from('PowerPoint Document', 'utf16le')) ||
      buffer.includes(Buffer.from('Current User', 'utf16le')) ||
      buffer.includes(Buffer.from('PowerPoint Document', 'latin1'));
    if (isPpt) {
      return { mimeType: 'application/vnd.ms-powerpoint', extension: 'ppt' };
    }

    const isExcel =
      buffer.includes(Buffer.from('Workbook', 'utf16le')) ||
      buffer.includes(Buffer.from('Book', 'utf16le')) ||
      buffer.includes(Buffer.from('Workbook', 'latin1'));
    if (isExcel) {
      return { mimeType: 'application/vnd.ms-excel', extension: 'xls' };
    }

    // Fall back to originalName extension if valid legacy office
    if (originalName) {
      if (/\.docx?$/i.test(originalName)) {
        return { mimeType: 'application/msword', extension: 'doc' };
      }
      if (/\.pptx?$/i.test(originalName)) {
        return { mimeType: 'application/vnd.ms-powerpoint', extension: 'ppt' };
      }
      if (/\.xlsx?$/i.test(originalName)) {
        return { mimeType: 'application/vnd.ms-excel', extension: 'xls' };
      }
    }

    return { mimeType: 'application/msword', extension: 'doc' };
  }

  // 7. Check Plain Text, Markdown, and CSV
  // Must be valid UTF-8, must not contain binary null bytes (0x00), and must have allowed extension
  if (!buffer.includes(0x00)) {
    const isUtf8 = isBufferValidUtf8(buffer);
    if (isUtf8 && originalName) {
      if (/\.md$/i.test(originalName)) {
        return { mimeType: 'text/markdown', extension: 'md' };
      }
      if (/\.csv$/i.test(originalName)) {
        return { mimeType: 'text/csv', extension: 'csv' };
      }
      if (/\.txt$/i.test(originalName)) {
        return { mimeType: 'text/plain', extension: 'txt' };
      }
    }
  }

  return null;
}

/**
 * Validates that buffer consists of valid UTF-8 sequences.
 */
function isBufferValidUtf8(buffer: Buffer): boolean {
  try {
    const text = buffer.toString('utf-8');
    // Ensure text encodes back without byte-level corruption
    const roundtrip = Buffer.from(text, 'utf-8');
    return roundtrip.length === buffer.length;
  } catch {
    return false;
  }
}

/**
 * Determines whether a MIME type represents an image.
 */
export function isImageMimeType(mimeType: string): boolean {
  return (
    mimeType === 'image/jpeg' ||
    mimeType === 'image/png' ||
    mimeType === 'image/heic' ||
    mimeType === 'image/heif'
  );
}

/**
 * Determines the initial processing job step based on MIME type (§4.1, §9, #150).
 */
export function determineInitialProcessingStep(mimeType: string): string {
  switch (mimeType) {
    case 'application/pdf':
      return 'ingestion';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/msword':
    case 'application/vnd.oasis.opendocument.text':
      return 'office_extraction';
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    case 'application/vnd.ms-powerpoint':
    case 'application/vnd.oasis.opendocument.presentation':
      return 'slide_extraction';
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.ms-excel':
    case 'application/vnd.oasis.opendocument.spreadsheet':
    case 'text/csv':
      return 'tabular_extraction';
    case 'text/plain':
    case 'text/markdown':
      return 'text_chunking';
    case 'image/jpeg':
    case 'image/png':
    case 'image/heic':
    case 'image/heif':
      return 'ocr';
    default:
      return 'ingestion';
  }
}

