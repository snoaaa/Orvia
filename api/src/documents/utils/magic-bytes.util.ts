export type AllowedMimeType =
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'image/heic'
  | 'image/heif';

export type AllowedFileExtension = 'pdf' | 'jpg' | 'jpeg' | 'png' | 'heic' | 'heif';

export interface DetectedFileType {
  mimeType: AllowedMimeType;
  extension: 'pdf' | 'jpg' | 'png' | 'heic';
}

export const ALLOWED_MIME_TYPES: readonly AllowedMimeType[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
] as const;

const PDF_MAGIC = Buffer.from('%PDF-'); // 0x25, 0x50, 0x44, 0x46, 0x2D
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const FTYP_BOX = Buffer.from('ftyp'); // 0x66, 0x74, 0x79, 0x70

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
 * Detects the file format and MIME type strictly from the file content's magic bytes.
 * Never relies on untrusted user-supplied filenames or HTTP headers.
 *
 * Supported formats:
 * - PDF (`application/pdf`)
 * - JPEG (`image/jpeg`)
 * - PNG (`image/png`)
 * - HEIC / HEIF (`image/heic`)
 *
 * Returns null if the buffer does not match any allowed format.
 */
export function detectMimeTypeFromBuffer(buffer: Buffer): DetectedFileType | null {
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

      // Check compatible brands if boxSize is valid
      const scanLimit = Math.min(boxSize > 0 ? boxSize : buffer.length, buffer.length, 64);
      for (let offset = 12; offset + 4 <= scanLimit; offset += 4) {
        const brand = buffer.subarray(offset, offset + 4).toString('latin1').toLowerCase().trim();
        if (HEIC_BRANDS.has(brand)) {
          return { mimeType: 'image/heic', extension: 'heic' };
        }
      }
    }
  }

  return null;
}

