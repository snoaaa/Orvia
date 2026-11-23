/**
 * Version history of a document (#116, §4.5). Mirrors `GET /documents/{id}/versions` (#107);
 * the replace upload reuses the upload model of #115.
 */

/** Processing status of a version (spec §3.1). */
export type VersionStatus =
  | 'pending'
  | 'ocr'
  | 'segmentation'
  | 'indexing'
  | 'available'
  | 'error';

export interface VersionUploader {
  id: string;
  name: string;
  email: string;
}

/** One row of the version list (the fields the screen needs). */
export interface DocumentVersionItem {
  id: string;
  documentId: string;
  versionNumber: number;
  /** Creation date (ISO string). */
  date: string;
  uploader: VersionUploader | null;
  /** Size in bytes. */
  size: number;
  status: VersionStatus | string;
  mimeType: string;
  isCurrent: boolean;
}

/** The part of `GET /documents/{id}` the screen needs. */
export interface DocumentSummary {
  id: string;
  title: string;
}

export interface VersionStatusDisplay {
  label: string;
  badgeClass: string;
}

const STATUS_DISPLAY: Record<string, VersionStatusDisplay> = {
  pending: { label: 'Pending', badgeClass: 'bg-light-secondary text-secondary' },
  ocr: { label: 'OCR', badgeClass: 'bg-light-warning text-warning' },
  segmentation: { label: 'Segmentation', badgeClass: 'bg-light-warning text-warning' },
  indexing: { label: 'Indexing', badgeClass: 'bg-light-warning text-warning' },
  available: { label: 'Available', badgeClass: 'bg-light-success text-success' },
  error: { label: 'Error', badgeClass: 'bg-light-danger text-danger' }
};

/** Label and badge colour of a status; an unknown status is shown as it is. */
export function statusDisplay(status: string): VersionStatusDisplay {
  return (
    STATUS_DISPLAY[status] ?? { label: status, badgeClass: 'bg-light-secondary text-secondary' }
  );
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heif'
};

/** File extension (without dot) for a MIME type, or '' when unknown. */
export function extensionOfMime(mimeType: string): string {
  return EXTENSION_BY_MIME[mimeType.toLowerCase()] ?? '';
}

/**
 * Name of a downloaded version: `<title>-v<N>.<ext>`. The API sends a Content-Disposition name, but
 * the browser cannot read it across origins, so the name is built here.
 */
export function versionFileName(title: string, versionNumber: number, mimeType: string): string {
  const base = title.trim().replace(/[\\/:*?"<>|]+/g, '_') || 'document';
  const ext = extensionOfMime(mimeType);
  return `${base}-v${versionNumber}${ext ? `.${ext}` : ''}`;
}
