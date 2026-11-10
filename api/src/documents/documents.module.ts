import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { DocumentsController } from './controllers/documents.controller.js';
import { DocumentsService } from './services/documents.service.js';

@Module({
  imports: [StorageModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService, StorageModule],
})
export class DocumentsModule {}
