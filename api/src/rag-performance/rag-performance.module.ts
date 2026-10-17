import { Module } from '@nestjs/common';
import { RagPerformanceController } from './controllers/rag-performance.controller.js';
import { RagPerformanceService } from './services/rag-performance.service.js';

@Module({
  controllers: [RagPerformanceController],
  providers: [RagPerformanceService],
  exports: [RagPerformanceService],
})
export class RagPerformanceModule {}
