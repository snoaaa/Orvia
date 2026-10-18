import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service.js';
import { Public } from './auth/decorators/auth.decorators.js';

@ApiTags('Health & Database')
@Public()
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'API root info' })
  @ApiResponse({ status: 200, description: 'API root info' })
  getHello() {
    return this.appService.getHello();
  }

  @Get('health')
  @ApiOperation({ summary: 'Health check verifying MySQL database communication' })
  @ApiResponse({ status: 200, description: 'Database and service health status' })
  async getHealth() {
    return this.appService.getHealth();
  }
}
