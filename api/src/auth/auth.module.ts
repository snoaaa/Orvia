import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { AuthConfig } from '../config/index.js';
import { AuthDevController } from './controllers/auth-dev.controller.js';
import { AuthController } from './controllers/auth.controller.js';
import { UserSessionsController } from './controllers/user-sessions.controller.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { PermissionsGuard } from './guards/permissions.guard.js';
import { AuthUserService } from './services/auth-user.service.js';
import { SessionCleanupService } from './services/session-cleanup.service.js';
import { SessionService } from './services/session.service.js';
import { TokenService } from './services/token.service.js';

/**
 * Authentication and authorization (#13). Both guards are global: every route requires a
 * valid token unless marked @Public(), then @RequirePermission() is enforced.
 * Order matters: JwtAuthGuard sets request.user before PermissionsGuard reads it.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<AuthConfig>('auth').jwtAccessSecret,
        signOptions: { algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController, UserSessionsController, AuthDevController],
  providers: [
    TokenService,
    AuthUserService,
    SessionService,
    SessionCleanupService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [TokenService, AuthUserService, SessionService],
})
export class AuthModule {}
