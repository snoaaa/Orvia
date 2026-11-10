import { Module } from '@nestjs/common';
import { DocumentsController } from './controllers/documents.controller.js';
import { AntivirusService } from './services/antivirus.service.js';
import { DocumentsService } from './services/documents.service.js';
import { FileValidationService } from './services/file-validation.service.js';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, AntivirusService, FileValidationService],
  exports: [DocumentsService, AntivirusService, FileValidationService],
})
export class DocumentsModule {}
