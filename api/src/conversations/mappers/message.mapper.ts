import { MessageEntity } from '../entities/message.entity.js';
import type { CreateMessageDto } from '../dto/create-message.dto.js';

export class MessageMapper {
  static toEntity(raw: {
    id: string;
    conversationId: string;
    role: string;
    content: string;
    modelUsed?: string | null;
    parameters?: Record<string, unknown> | null;
    status?: string | null;
    authSnapshot?: Record<string, unknown> | null;
    createdAt?: Date;
    updatedAt?: Date;
    deletedAt?: Date | null;
  }): MessageEntity {
    return new MessageEntity({
      id: raw.id,
      conversationId: raw.conversationId,
      role: raw.role,
      content: raw.content,
      modelUsed: raw.modelUsed || 'default',
      parameters: raw.parameters || null,
      status: raw.status || 'completed',
      authSnapshot: raw.authSnapshot || null,
      createdAt: raw.createdAt || new Date(),
      updatedAt: raw.updatedAt || new Date(),
      deletedAt: raw.deletedAt ?? null,
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
      authSnapshot: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}
