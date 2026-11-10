import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { DocumentsController } from './controllers/documents.controller.js';
import { AntivirusService } from './services/antivirus.service.js';
import { DocumentsService } from './services/documents.service.js';
import { FileValidationService } from './services/file-validation.service.js';

@Module({
  imports: [StorageModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, AntivirusService, FileValidationService],
  exports: [DocumentsService, AntivirusService, FileValidationService, StorageModule],
})
export class DocumentsModule {}
