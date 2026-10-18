import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  CreateOfflineSelectionDto,
  RegisterDeviceDto,
  SubmitPendingQuestionDto,
  SyncChangesDto,
} from '../dto/index.js';
import {
  DeviceEntity,
  OfflineSelectionEntity,
  PendingQuestionEntity,
} from '../entities/index.js';
import { RequirePermission } from '../../auth/decorators/auth.decorators.js';
import { MobileSyncService } from '../services/mobile-sync.service.js';

@ApiTags('Mobile & Synchronization')
@ApiBearerAuth('bearer-jwt')
@ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
@ApiResponse({ status: 403, description: 'Missing permission or suspended account' })
@Controller('mobile-sync')
export class MobileSyncController {
  constructor(private readonly mobileSyncService: MobileSyncService) {}

  @Post('devices')
  @RequirePermission('devices:register')
  @ApiOperation({ summary: 'Register a mobile device for sync' })
  @ApiResponse({ status: 201, description: 'Device registered', type: DeviceEntity })
  async registerDevice(@Body() dto: RegisterDeviceDto): Promise<DeviceEntity> {
    return this.mobileSyncService.registerDevice(dto);
  }

  @Get('devices/user/:userId')
  @RequirePermission('devices:manage')
  @ApiOperation({ summary: 'List registered devices for a user' })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'Devices list', type: [DeviceEntity] })
  async listDevices(@Param('userId') userId: string): Promise<DeviceEntity[]> {
    return this.mobileSyncService.listDevices(userId);
  }

  @Post('offline-selections')
  @RequirePermission('offline:select')
  @ApiOperation({ summary: 'Register documents/spaces selected for offline caching' })
  @ApiResponse({ status: 201, description: 'Offline selection registered', type: OfflineSelectionEntity })
  async createOfflineSelection(@Body() dto: CreateOfflineSelectionDto): Promise<OfflineSelectionEntity> {
    return this.mobileSyncService.createOfflineSelection(dto);
  }

  @Post('pending-questions')
  @RequirePermission('messages:send')
  @ApiOperation({ summary: 'Queue an offline question submitted from mobile client' })
  @ApiResponse({ status: 201, description: 'Question queued for resolution', type: PendingQuestionEntity })
  async submitPendingQuestion(@Body() dto: SubmitPendingQuestionDto): Promise<PendingQuestionEntity> {
    return this.mobileSyncService.queuePendingQuestion(dto);
  }

  @Post('sync')
  @RequirePermission('sync:execute')
  @ApiOperation({ summary: 'Synchronize mobile offline changes with backend' })
  @ApiResponse({ status: 200, description: 'Sync processed successfully' })
  async syncChanges(@Body() dto: SyncChangesDto) {
    return this.mobileSyncService.processSync(dto);
  }
}
