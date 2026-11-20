import type { CreateConversationDto } from '../dto/create-conversation.dto.js';
import { ConversationDetailEntity } from '../entities/conversation-detail.entity.js';
import { ConversationEntity } from '../entities/conversation.entity.js';
import { MessageMapper, type RawMessage } from './message.mapper.js';

export interface RawConversation {
  id: string;
  userId: string;
  spaceId: string;
  title: string;
  createdAt?: Date;
  updatedAt?: Date;
  space?: { name: string } | null;
  _count?: { messages?: number } | null;
  messages?: RawMessage[];
}

export class ConversationMapper {
  static toEntity(raw: RawConversation): ConversationEntity {
    return new ConversationEntity({
      id: raw.id,
      userId: raw.userId,
      spaceId: raw.spaceId,
      ...(raw.space?.name !== undefined ? { spaceName: raw.space.name } : {}),
      title: raw.title,
      ...(raw._count?.messages !== undefined ? { messageCount: raw._count.messages } : {}),
      createdAt: raw.createdAt || new Date(),
      updatedAt: raw.updatedAt || new Date(),
    });
  }

  static toDetailEntity(raw: RawConversation): ConversationDetailEntity {
    return new ConversationDetailEntity({
      id: raw.id,
      userId: raw.userId,
      spaceId: raw.spaceId,
      ...(raw.space?.name !== undefined ? { spaceName: raw.space.name } : {}),
      title: raw.title,
      createdAt: raw.createdAt || new Date(),
      updatedAt: raw.updatedAt || new Date(),
      messages: (raw.messages ?? []).map((msg) => MessageMapper.toEntity(msg)),
    });
  }

  static fromDtoToCreateInput(dto: CreateConversationDto, id: string): ConversationEntity {
    return new ConversationEntity({
      id,
      userId: dto.userId,
      spaceId: dto.spaceId,
      title: dto.title,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}
