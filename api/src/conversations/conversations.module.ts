import { Module } from '@nestjs/common';
import { ConversationsController } from './controllers/conversations.controller.js';
import { ConversationsService } from './services/conversations.service.js';

@Module({
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
