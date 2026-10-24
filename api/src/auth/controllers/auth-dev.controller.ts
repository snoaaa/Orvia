import { Body, CanActivate, Controller, HttpCode, Injectable, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { UserStatus } from '@prisma/client';
import type { AuthConfig } from '../../config/index.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Public } from '../decorators/auth.decorators.js';
import { DevTokenDto } from '../dto/index.js';
import { TokenService, type IssuedAccessToken } from '../services/token.service.js';

/** Hidden (404) unless AUTH_DEV_TOOLS=true and not in production. */
@Injectable()
class AuthDevToolsGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    if (this.config.getOrThrow<AuthConfig>('auth').devTools) return true;
    throw new NotFoundException();
  }
}

/**
 * DEV-ONLY. Login (#8, #10) does not exist yet, so this issues an access token for any
 * existing user by email, to test the guards. Remove once the real login endpoints exist.
 */
@ApiTags('Authentication (dev tools)')
@Public()
@UseGuards(AuthDevToolsGuard)
@Controller('auth/dev')
export class AuthDevController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  @Post('token')
  @HttpCode(200)
  @ApiOperation({ summary: '[DEV] Get an access token for an existing user (no password check)' })
  async token(@Body() dto: DevTokenDto): Promise<IssuedAccessToken & { userId: string }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.trim().toLowerCase() } });
    if (!user) throw new NotFoundException(`No user with email ${dto.email}`);
    return { userId: user.id, ...(await this.tokens.issueAccessToken(user.id)) };
  }

  @Post('fixtures')
  @HttpCode(200)
  @ApiOperation({
    summary: '[DEV] Create two demo schools with users in different roles and statuses (idempotent)',
    description:
      'Role assignment endpoints do not exist yet (#9), so this prepares data to test the guards and school scoping.',
  })
  async fixtures() {
    const schools: Record<string, string> = {};
    for (const name of DEMO_SCHOOLS) {
      const existing = await this.prisma.school.findFirst({ where: { name } });
      schools[name] = (existing ?? (await this.prisma.school.create({ data: { name } }))).id;
    }

    const users = [];
    for (const u of DEMO_USERS) {
      const role = await this.prisma.role.findUnique({ where: { name: u.role } });
      if (!role) throw new NotFoundException(`Role ${u.role} not found: run npm run seed first`);
      const schoolId = schools[u.school];
      const user = await this.prisma.user.upsert({
        where: { email: u.email },
        update: { status: u.status },
        create: { email: u.email, fullName: u.fullName, status: u.status },
      });
      const assigned = await this.prisma.userAssignment.findFirst({
        where: { userId: user.id, roleId: role.id, schoolId },
      });
      if (!assigned) {
        await this.prisma.userAssignment.create({ data: { userId: user.id, roleId: role.id, schoolId } });
      }
      users.push({ email: u.email, userId: user.id, role: u.role, status: u.status, school: u.school, schoolId });
    }
    return { schools, users };
  }
}

const DEMO_SCHOOLS = ['Demo School A', 'Demo School B'] as const;

const DEMO_USERS: {
  email: string;
  fullName: string;
  role: string;
  status: UserStatus;
  school: (typeof DEMO_SCHOOLS)[number];
}[] = [
  { email: 'admin.a@demo.test', fullName: 'Admin A', role: 'SCHOOL_ADMIN', status: 'ACTIVE', school: 'Demo School A' },
  { email: 'student.a@demo.test', fullName: 'Student A', role: 'STUDENT', status: 'ACTIVE', school: 'Demo School A' },
  { email: 'suspended.a@demo.test', fullName: 'Suspended A', role: 'SCHOOL_ADMIN', status: 'SUSPENDED', school: 'Demo School A' },
  { email: 'invited.a@demo.test', fullName: 'Invited A', role: 'STUDENT', status: 'INVITED', school: 'Demo School A' },
  { email: 'admin.b@demo.test', fullName: 'Admin B', role: 'SCHOOL_ADMIN', status: 'ACTIVE', school: 'Demo School B' },
  { email: 'student.b@demo.test', fullName: 'Student B', role: 'STUDENT', status: 'ACTIVE', school: 'Demo School B' },
];
