import type { Document, DocumentVersion } from '@prisma/client';
import type { CreateDocumentDto } from '../dto/create-document.dto.js';
import { DocumentEntity } from '../entities/document.entity.js';
import { normalizeTags } from '../utils/document-filters.util.js';
import { DocumentVersionMapper } from './document-version.mapper.js';

export class DocumentMapper {
  static toEntity(
    raw: Document,
    currentVersion?: DocumentVersion | null,
    options: { forReader?: boolean } = {},
  ): DocumentEntity {
    return new DocumentEntity({
      id: raw.id,
      spaceId: raw.spaceId,
      title: raw.title,
      author: raw.author,
      tags: raw.tags,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      deletedAt: raw.deletedAt ?? null,
      currentVersion: currentVersion ? DocumentVersionMapper.toEntity(currentVersion, options) : null,
    });
  }

  static fromDtoToCreateInput(dto: CreateDocumentDto, id: string): {
    id: string;
    title: string;
    author: string;
    tags: string;
    spaceId: string;
  } {
    return {
      id,
      title: dto.title,
      author: dto.author || '',
      tags: normalizeTags(dto.tags),
      spaceId: dto.spaceId,
    };
  }
}
