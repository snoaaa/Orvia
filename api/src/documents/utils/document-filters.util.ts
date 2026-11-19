import type { Prisma } from '@prisma/client';

/** Processing statuses of a document version, in pipeline order (spec §3.1). New versions start 'pending'. */
export const DOCUMENT_STATUSES = ['pending', 'ocr', 'segmentation', 'indexing', 'available', 'error'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** The status a version needs before readers (non-managers) may see its document (#111). */
export const AVAILABLE_STATUS: DocumentStatus = 'available';

/** File types the list can filter on, from the MIME type of the current version (the formats uploads accept). */
export const DOCUMENT_TYPES = ['pdf', 'image', 'word', 'presentation', 'spreadsheet', 'text'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

const MIME_TYPES: Record<Exclude<DocumentType, 'image'>, string[]> = {
  pdf: ['application/pdf'],
  word: [
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.oasis.opendocument.text',
  ],
  presentation: [
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.presentation',
  ],
  spreadsheet: [
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.spreadsheet',
    'text/csv',
  ],
  text: ['text/plain', 'text/markdown'],
};

/**
 * Splits a comma-separated tag list into clean tags: trimmed, without empty ones, each kept once
 * (case-insensitive, first spelling wins).
 */
export function parseTags(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const tag of (raw ?? '').split(',').map((t) => t.trim())) {
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
  }
  return tags;
}

/** The stored form of a tag list (#111): "Math, physics,," becomes "Math,physics". */
export function normalizeTags(raw: string | null | undefined): string {
  return parseTags(raw).join(',');
}

/**
 * Documents carrying `tag` as a whole tag in their normalized list (case-insensitive with the MySQL
 * collation): "math" matches "math" and "x,math,y", not "mathematics".
 */
export function tagWhere(tag: string): Prisma.DocumentWhereInput {
  return {
    OR: [
      { tags: tag },
      { tags: { startsWith: `${tag},` } },
      { tags: { endsWith: `,${tag}` } },
      { tags: { contains: `,${tag},` } },
    ],
  };
}

/** Version condition for a file type. */
export function typeWhere(type: DocumentType): Prisma.DocumentVersionWhereInput {
  return type === 'image' ? { mimeType: { startsWith: 'image/' } } : { mimeType: { in: MIME_TYPES[type] } };
}
