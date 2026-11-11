import type { DocumentVersion } from '@prisma/client';
import { DocumentVersionEntity } from '../entities/document-version.entity.js';

export class DocumentVersionMapper {
  static toEntity(raw: DocumentVersion): DocumentVersionEntity {
    return new DocumentVersionEntity({
      id: raw.id,
      documentId: raw.documentId,
      versionNo: raw.versionNo,
      storageKey: raw.storageKey,
      mimeType: raw.mimeType,
      checksum: raw.checksum,
      status: raw.status,
      pageCount: raw.pageCount,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }
}

