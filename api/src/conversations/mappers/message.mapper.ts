import type { DocumentVersionStatus, Prisma } from '@prisma/client';
import type { CreateMessageDto } from '../dto/create-message.dto.js';
import { MessageCitationEntity } from '../entities/message-citation.entity.js';
import { MessageEntity } from '../entities/message.entity.js';

export interface RawMessageReference {
  id: string;
  documentVersionId: string;
  pageOrImageId: string;
  excerpt: string;
  coordinates: string | null;
  documentVersion: {
    id: string;
    documentId: string;
    versionNo: number;
    status: DocumentVersionStatus;
    document: {
      title: string;
      deletedAt: Date | null;
    };
  };
}

export interface RawMessage {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  modelUsed?: string | null;
  parameters?: Prisma.JsonValue | Record<string, unknown> | null;
  status?: string | null;
  references?: RawMessageReference[];
  createdAt?: Date;
  updatedAt?: Date;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export class MessageMapper {
  static toCitationEntity(ref: RawMessageReference): MessageCitationEntity {
    return new MessageCitationEntity({
      id: ref.id,
      documentId: ref.documentVersion.documentId,
      versionId: ref.documentVersionId,
      documentName: ref.documentVersion.document.title,
      versionNumber: ref.documentVersion.versionNo,
      pageOrImageId: ref.pageOrImageId,
      excerpt: ref.excerpt,
      coordinates: ref.coordinates ?? null,
      available: ref.documentVersion.document.deletedAt === null && ref.documentVersion.status === 'available',
    });
  }

  static toEntity(raw: RawMessage): MessageEntity {
    return new MessageEntity({
      id: raw.id,
      conversationId: raw.conversationId,
      role: raw.role,
      content: raw.content,
      modelUsed: raw.modelUsed || 'default',
      parameters: asRecord(raw.parameters),
      status: raw.status || 'completed',
      citations: (raw.references ?? []).map((ref) => MessageMapper.toCitationEntity(ref)),
      createdAt: raw.createdAt || new Date(),
      updatedAt: raw.updatedAt || new Date(),
    });
  }

  static fromDtoToCreateInput(dto: CreateMessageDto, id: string, conversationId: string): MessageEntity {
    return new MessageEntity({
      id,
      conversationId,
      role: dto.role,
      content: dto.content,
      modelUsed: dto.modelUsed || 'default',
      parameters: dto.parameters || null,
      status: 'completed',
      citations: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}
