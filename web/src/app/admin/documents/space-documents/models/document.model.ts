/**
 * Documents of a space in the web portal (#114). Mirrors `GET /documents` (#111, #112),
 * `PATCH /documents/{id}` (#105) and `DELETE /documents/{id}` (#108).
 */

/** Processing statuses of a version, in pipeline order (spec §3.1, #112). */
export type DocumentStatus =
  | 'pending'
  | 'ocr'
  | 'segmentation'
  | 'indexing'
  | 'available'
  | 'error';

/** File types the API filters on (`type`), from the MIME type of the current version. */
export type DocumentType = 'pdf' | 'image' | 'word' | 'presentation' | 'spreadsheet' | 'text';

/** Same limits as the API. */
export const DOCUMENT_SEARCH_MAX_LENGTH = 200;
export const DOCUMENT_MAX_TAGS = 10;
/** `documents.title` / `documents.author` are VARCHAR(191). */
export const DOCUMENT_TEXT_MAX_LENGTH = 191;

export const DOCUMENT_STATUS_OPTIONS: readonly {
  value: DocumentStatus;
  label: string;
  badgeClass: string;
}[] = [
  {
    value: 'pending',
    label: 'Pending',
    badgeClass: 'bg-light-secondary text-secondary border border-secondary'
  },
  { value: 'ocr', label: 'OCR', badgeClass: 'bg-light-info text-info border border-info' },
  {
    value: 'segmentation',
    label: 'Segmentation',
    badgeClass: 'bg-light-info text-info border border-info'
  },
  {
    value: 'indexing',
    label: 'Indexing',
    badgeClass: 'bg-light-primary text-primary border border-primary'
  },
  {
    value: 'available',
    label: 'Available',
    badgeClass: 'bg-light-success text-success border border-success'
  },
  { value: 'error', label: 'Error', badgeClass: 'bg-light-danger text-danger border border-danger' }
];

/** Statuses a version moves on from by itself: the list refreshes while a document is in one of them. */
export const PROCESSING_STATUSES: ReadonlySet<string> = new Set<DocumentStatus>([
  'pending',
  'ocr',
  'segmentation',
  'indexing'
]);

export const DOCUMENT_TYPE_OPTIONS: readonly { value: DocumentType; label: string }[] = [
  { value: 'pdf', label: 'PDF' },
  { value: 'image', label: 'Image' },
  { value: 'word', label: 'Word' },
  { value: 'presentation', label: 'Presentation' },
  { value: 'spreadsheet', label: 'Spreadsheet' },
  { value: 'text', label: 'Text' }
];

/** MIME types of each type, as in the API (`document-filters.util.ts`); images are any `image/*`. */
const MIME_TYPES: Record<Exclude<DocumentType, 'image'>, readonly string[]> = {
  pdf: ['application/pdf'],
  word: [
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.oasis.opendocument.text'
  ],
  presentation: [
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.presentation'
  ],
  spreadsheet: [
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.spreadsheet',
    'text/csv'
  ],
  text: ['text/plain', 'text/markdown']
};

export interface DocumentVersion {
  id: string;
  documentId: string;
  versionNo: number;
  mimeType: string;
  status: DocumentStatus;
  /** Why processing failed; only sent to document managers. */
  statusError?: string | null;
  statusChangedAt?: string;
  pageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SpaceDocument {
  id: string;
  spaceId: string;
  title: string;
  author: string;
  /** Comma-separated, normalized by the API ("math,exam"). */
  tags: string;
  createdAt: string;
  updatedAt: string;
  currentVersion?: DocumentVersion | null;
}

export interface PaginatedDocuments {
  data: SpaceDocument[];
  total: number;
  page: number;
  limit: number;
  totalPages?: number;
}

export interface DocumentListFilter {
  spaceId: string;
  page: number;
  limit: number;
  q?: string;
  /** Comma-separated; a document must carry all of them. */
  tags?: string;
  status?: DocumentStatus;
  type?: DocumentType;
}

/** Body of `PATCH /documents/{id}` sent by the metadata form. */
export interface UpdateDocumentPayload {
  title?: string;
  author?: string;
  tags?: string;
}

export type DocumentFormField = 'title' | 'author' | 'tags';

export interface DocumentFormErrors {
  fields: Partial<Record<DocumentFormField, string>>;
  general: string | null;
}

export function documentTypeOf(mimeType: string | null | undefined): DocumentType | null {
  if (!mimeType) return null;
  if (mimeType.startsWith('image/')) return 'image';
  const entry = Object.entries(MIME_TYPES).find(([, mimes]) => mimes.includes(mimeType));
  return entry ? (entry[0] as DocumentType) : null;
}

/** "PDF", "Image"..., or the MIME type itself for a format outside the list. */
export function documentTypeLabel(mimeType: string | null | undefined): string {
  const type = documentTypeOf(mimeType);
  if (!type) return mimeType || '—';
  return DOCUMENT_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

export function documentStatusOption(
  status: string | null | undefined
): (typeof DOCUMENT_STATUS_OPTIONS)[number] | undefined {
  return DOCUMENT_STATUS_OPTIONS.find((o) => o.value === status);
}

/** The tags of a document as a list ("math,exam" → ["math", "exam"]). */
export function tagList(tags: string | null | undefined): string[] {
  return (tags ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}
