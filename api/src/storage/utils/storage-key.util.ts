import { BadRequestException } from '@nestjs/common';

/**
 * Normalizes and validates a relative storage key, ensuring no path traversal attacks.
 * Disallows '..', '.', leading/trailing whitespace, and backslashes.
 *
 * @param key Relative key
 * @returns Normalized forward-slash relative path
 */
export function sanitizeStorageKey(key: string): string {
  if (!key || typeof key !== 'string' || key.trim().length === 0) {
    throw new BadRequestException('Storage key cannot be empty');
  }

  if (key.includes('\0')) {
    throw new BadRequestException('Storage key cannot contain null bytes');
  }

  // Normalize slashes to forward slash and trim leading slashes
  const normalized = key.trim().replace(/\\/g, '/').replace(/^\/+/, '');

  if (normalized.length === 0) {
    throw new BadRequestException('Storage key cannot resolve to root');
  }

  // Guard against Windows drive letters (e.g. C: or D:)
  if (/^[a-zA-Z]:/.test(normalized)) {
    throw new BadRequestException('Storage key cannot contain drive letters');
  }

  // Guard against path traversal segments
  const segments = normalized.split('/');
  for (const seg of segments) {
    if (seg === '..' || seg === '.') {
      throw new BadRequestException(`Invalid storage key segment '${seg}': path traversal is forbidden`);
    }
  }

  return normalized;
}

export interface DocumentStorageKeyParams {
  spaceId: string;
  documentId: string;
  version: number;
  extension?: string;
}

/**
 * Generates standard relative document storage key per Spec §5.2 (#101):
 * `spaces/{spaceId}/docs/{documentId}/v{version}.{ext}`
 *
 * Stored directly in `document_versions.storage_key` in MySQL without any absolute paths.
 */
export function buildDocumentStorageKey(params: DocumentStorageKeyParams): string {
  const { spaceId, documentId, version, extension } = params;

  if (!spaceId || typeof spaceId !== 'string' || spaceId.trim().length === 0) {
    throw new BadRequestException('spaceId is required to construct a document storage key');
  }
  if (!documentId || typeof documentId !== 'string' || documentId.trim().length === 0) {
    throw new BadRequestException('documentId is required to construct a document storage key');
  }
  if (!version || typeof version !== 'number' || version < 1 || !Number.isInteger(version)) {
    throw new BadRequestException('version must be a positive integer');
  }

  const cleanExt = (extension || '').replace(/^\.+/, '').trim().toLowerCase();
  const extSuffix = cleanExt.length > 0 ? `.${cleanExt}` : '';

  const rawKey = `spaces/${spaceId.trim()}/docs/${documentId.trim()}/v${version}${extSuffix}`;
  return sanitizeStorageKey(rawKey);
}

