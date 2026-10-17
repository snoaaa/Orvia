import { Module } from '@nestjs/common';
import { DocumentsController } from './controllers/documents.controller.js';
import { DocumentsService } from './services/documents.service.js';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
