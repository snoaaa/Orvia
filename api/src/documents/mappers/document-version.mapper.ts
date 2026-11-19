import type { DocumentVersion } from '@prisma/client';
import { DocumentVersionEntity } from '../entities/document-version.entity.js';

export class DocumentVersionMapper {
  /** `forReader`: leave out the failure reason, which only document managers may see (#112). */
  static toEntity(raw: DocumentVersion, options: { forReader?: boolean } = {}): DocumentVersionEntity {
    return new DocumentVersionEntity({
      id: raw.id,
      documentId: raw.documentId,
      versionNo: raw.versionNo,
      storageKey: raw.storageKey,
      mimeType: raw.mimeType,
      checksum: raw.checksum,
      status: raw.status,
      ...(options.forReader ? {} : { statusError: raw.statusError ?? null }),
      statusChangedAt: raw.statusChangedAt,
      pageCount: raw.pageCount,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }
}

