import { Module } from '@nestjs/common';
import { OverviewController } from './controllers/overview.controller.js';
import { OverviewService } from './services/overview.service.js';

@Module({
  controllers: [OverviewController],
  providers: [OverviewService],
})
export class OverviewModule {}
