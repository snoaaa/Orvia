import { Module } from '@nestjs/common';
import { MobileSyncController } from './controllers/mobile-sync.controller.js';
import { MobileSyncService } from './services/mobile-sync.service.js';

@Module({
  controllers: [MobileSyncController],
  providers: [MobileSyncService],
  exports: [MobileSyncService],
})
export class MobileSyncModule {}
