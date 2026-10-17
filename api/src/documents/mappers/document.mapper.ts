import { DocumentEntity } from '../entities/document.entity.js';
import type { CreateDocumentDto } from '../dto/create-document.dto.js';
import type { Prisma } from '@prisma/client';

export class DocumentMapper {
  static toEntity(raw: {
    id: string;
    spaceId: string;
    title: string;
    metadata?: unknown;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
  }): DocumentEntity {
    const meta = (raw.metadata as Record<string, unknown>) || {};
    return new DocumentEntity({
      id: raw.id,
      spaceId: raw.spaceId,
      title: raw.title,
      author: typeof meta.author === 'string' ? meta.author : '',
      tags: typeof meta.tags === 'string' ? meta.tags : '',
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      deletedAt: raw.deletedAt ?? null,
    });
  }

  static fromDtoToCreateInput(dto: CreateDocumentDto, id: string): {
    id: string;
    title: string;
    url: string;
    spaceId: string;
    metadata: Prisma.InputJsonValue;
    createdAt: Date;
    updatedAt: Date;
  } {
    return {
      id,
      title: dto.title,
      url: dto.url,
      spaceId: dto.spaceId,
      metadata: {
        author: dto.author || '',
        tags: dto.tags || '',
        ...(dto.metadata),
      } as Prisma.InputJsonValue,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
}
