/**
 * Document upload of the web portal (#115). Mirrors the API contract of
 * `POST /documents/spaces/{spaceId}/upload` and `.../upload-image` (§4.1, #102, #103).
 */

/** Which endpoint a file goes to: images are OCR-processed, everything else is a document. */
export type UploadKind = 'document' | 'image';

export const IMAGE_EXTENSIONS: readonly string[] = ['jpg', 'jpeg', 'png', 'heic'];

export const DOCUMENT_EXTENSIONS: readonly string[] = [
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  'odt',
  'ods',
  'odp',
  'txt',
  'md',
  'csv'
];

/** Value of the `accept` attribute of the file picker. */
export const UPLOAD_ACCEPT = [...DOCUMENT_EXTENSIONS, ...IMAGE_EXTENSIONS]
  .map((ext) => `.${ext}`)
  .join(',');

/** Same limits as the API (`upload-document.dto.ts`). */
export const UPLOAD_TITLE_MAX_LENGTH = 255;
export const UPLOAD_AUTHOR_MAX_LENGTH = 255;
export const UPLOAD_TAGS_MAX_LENGTH = 500;

/** Number of files sent at the same time. */
export const UPLOAD_CONCURRENCY = 3;

/** `ready`: added and still editable; `queued`: waiting for a free slot; then `uploading`, `done` or `error`. */
export type UploadStatus = 'ready' | 'queued' | 'uploading' | 'done' | 'error';

/** Optional metadata sent with a file. */
export interface UploadMetadata {
  title: string;
  author: string;
  tags: string;
}

/** One row of the upload list. */
export interface UploadItem extends UploadMetadata {
  id: number;
  file: File;
  status: UploadStatus;
  /** 0 to 100, meaningful while uploading. */
  progress: number;
  /** The API's reason when the file was refused. */
  error: string | null;
}

/** Response of the upload endpoints (the part the screen needs). */
export interface UploadedDocument {
  id: string;
  title: string;
  spaceId?: string;
  status?: string;
}

/** What `DocumentUploadService.upload()` emits. */
export type UploadEvent =
  | { type: 'progress'; percent: number }
  | { type: 'done'; document: UploadedDocument };

/** Space as listed by `GET /documents/spaces` (the fields the picker needs). */
export interface UploadSpace {
  id: string;
  name: string;
  schoolId: string | null;
}

export interface UploadSpacePage {
  data: UploadSpace[];
  total: number;
}

/** Number of spaces loaded by the picker (a searchable picker is a follow-up). */
export const UPLOAD_SPACE_LIMIT = 100;

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Picks the endpoint from the file type; unknown types go to the document endpoint, which refuses them. */
export function uploadKindOf(file: { name: string; type?: string }): UploadKind {
  if (IMAGE_EXTENSIONS.includes(fileExtension(file.name))) return 'image';
  if (DOCUMENT_EXTENSIONS.includes(fileExtension(file.name))) return 'document';
  return file.type?.startsWith('image/') ? 'image' : 'document';
}

/** `1.5 MB`-style size for the file list. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Default title: the file name without its extension (what the API does when no title is sent). */
export function defaultTitle(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}
