import type { Document } from '@prisma/client';
import type { CreateDocumentDto } from '../dto/create-document.dto.js';
import { DocumentEntity } from '../entities/document.entity.js';

export class DocumentMapper {
  static toEntity(raw: Document): DocumentEntity {
    return new DocumentEntity({
      id: raw.id,
      spaceId: raw.spaceId,
      title: raw.title,
      author: raw.author,
      tags: raw.tags,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      deletedAt: raw.deletedAt ?? null,
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
      tags: dto.tags || '',
      spaceId: dto.spaceId,
    };
  }
}
