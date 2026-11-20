import { ApiProperty } from '@nestjs/swagger';
import { ConversationEntity } from './conversation.entity.js';
import { MessageEntity } from './message.entity.js';

export class ConversationDetailEntity extends ConversationEntity {
  @ApiProperty({ type: [MessageEntity], description: 'Chronological list of messages with citations' })
  messages: MessageEntity[];

  constructor(partial: Partial<ConversationDetailEntity>) {
    super(partial);
    this.messages = partial.messages ?? [];
  }
}
