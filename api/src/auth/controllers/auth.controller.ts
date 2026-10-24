import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../types/authenticated-user.js';

@ApiTags('Authentication')
@ApiBearerAuth('bearer-jwt')
@Controller('auth')
export class AuthController {
  @Get('me')
  @ApiOperation({ summary: 'Current user with roles, schools and permissions' })
  @ApiResponse({ status: 200, description: 'The authenticated user' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'Account suspended or not activated' })
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
