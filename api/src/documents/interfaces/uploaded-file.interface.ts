import type { Readable } from 'node:stream';

/**
 * Metadata and content buffer of an uploaded multipart file.
 * Matches Express.Multer.File shape without relying on global ambient type pollution.
 */
export interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
  stream?: Readable;
  destination?: string;
  filename?: string;
  path?: string;
}
