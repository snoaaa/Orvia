import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { DocumentsController } from './controllers/documents.controller.js';
import { AntivirusService } from './services/antivirus.service.js';
import { DocumentsService } from './services/documents.service.js';
import { FileValidationService } from './services/file-validation.service.js';
import { ImageConversionService } from './services/image-conversion.service.js';
import { ProcessingQueueService } from './services/processing-queue.service.js';

@Module({
  imports: [StorageModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, AntivirusService, FileValidationService, ImageConversionService, ProcessingQueueService],
  exports: [DocumentsService, AntivirusService, FileValidationService, ImageConversionService, ProcessingQueueService, StorageModule],
})
export class DocumentsModule {}
