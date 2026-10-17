import { ConversationEntity } from '../entities/conversation.entity.js';
import type { CreateConversationDto } from '../dto/create-conversation.dto.js';

export class ConversationMapper {
  static toEntity(raw: {
    id: string;
    userId: string;
    spaceId: string;
    title: string;
    createdAt?: Date;
    updatedAt?: Date;
    deletedAt?: Date | null;
  }): ConversationEntity {
    return new ConversationEntity({
      id: raw.id,
      userId: raw.userId,
      spaceId: raw.spaceId,
      title: raw.title,
      createdAt: raw.createdAt || new Date(),
      updatedAt: raw.updatedAt || new Date(),
      deletedAt: raw.deletedAt ?? null,
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
