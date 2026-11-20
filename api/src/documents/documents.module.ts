import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { DocumentsDevController } from './controllers/documents-dev.controller.js';
import { DocumentsController } from './controllers/documents.controller.js';
import { DocumentProcessingStatusService } from './services/document-processing-status.service.js';
import { AntivirusService } from './services/antivirus.service.js';
import { DocumentAccessService } from './services/document-access.service.js';
import { DocumentsService } from './services/documents.service.js';
import { FileValidationService } from './services/file-validation.service.js';
import { ImageConversionService } from './services/image-conversion.service.js';
import { ProcessingQueueService } from './services/processing-queue.service.js';

@Module({
  imports: [StorageModule],
  controllers: [DocumentsController, DocumentsDevController],
  providers: [DocumentsService, DocumentAccessService, DocumentProcessingStatusService, AntivirusService, FileValidationService, ImageConversionService, ProcessingQueueService],
  exports: [DocumentsService, DocumentProcessingStatusService, AntivirusService, FileValidationService, ImageConversionService, ProcessingQueueService, StorageModule],
})
export class DocumentsModule {}
