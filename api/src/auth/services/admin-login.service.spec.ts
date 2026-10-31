import { UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminLoginService } from './admin-login.service.js';

describe('AdminLoginService (Unit Tests)', () => {
  let service: AdminLoginService;
  let mockPrisma: any;
  let mockSessions: any;
  let mockAudit: any;

  const fakeContext = {
    ip: '127.0.0.1',
    userAgent: 'test-agent',
    deviceId: null,
  };
  const fakeTokenPair = {
    accessToken: 'access.token.jwt',
    refreshToken: 'session-id.secret',
    tokenType: 'Bearer' as const,
    expiresIn: 900,
    sessionId: '0b5dd953-8dac-48d7-84b8-ffca498c41ba',
    refreshExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  };

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    };
    mockSessions = {
      createSession: vi.fn().mockResolvedValue(fakeTokenPair),
    };
    mockAudit = {
      record: vi.fn().mockResolvedValue(undefined),
    };
    service = new AdminLoginService(mockPrisma, mockSessions, mockAudit);
  });

  it('rejects unknown email with generic 401 and performs dummy compare against timing attacks', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const bcryptCompareSpy = vi.spyOn(bcrypt, 'compare');

    await expect(
      service.login('unknown@wamdp.platform', 'password123!', fakeContext),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(bcryptCompareSpy).toHaveBeenCalled();
    expect(mockSessions.createSession).not.toHaveBeenCalled();
    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'login_failure',
        details: expect.objectContaining({
          email: 'unknown@wamdp.platform',
          reason: 'invalid_credentials',
          method: 'password',
        }),
      }),
    );
  });

  it('rejects non-local account with generic 401 and performs dummy compare', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'google-user-id',
      email: 'admin@google.com',
      authProvider: 'google',
      passwordHash: null,
      status: 'ACTIVE',
      assignments: [
        { schoolId: 's1', role: { name: 'SCHOOL_ADMIN', scope: 'school' } },
      ],
    });
    const bcryptCompareSpy = vi.spyOn(bcrypt, 'compare');

    await expect(
      service.login('admin@google.com', 'password123!', fakeContext),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(bcryptCompareSpy).toHaveBeenCalled();
    expect(mockSessions.createSession).not.toHaveBeenCalled();
    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'login_failure',
        details: expect.objectContaining({
          reason: 'invalid_credentials',
        }),
      }),
    );
  });

  it('rejects invalid password with generic 401', async () => {
    const hash = await bcrypt.hash('correct-admin-password', 4);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'admin-id',
      email: 'admin@school.edu',
      authProvider: 'local',
      passwordHash: hash,
      status: 'ACTIVE',
      assignments: [
        {
          schoolId: 'school-1',
          role: { name: 'SCHOOL_ADMIN', scope: 'school' },
        },
      ],
    });

    await expect(
      service.login('admin@school.edu', 'wrong-password', fakeContext),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(mockSessions.createSession).not.toHaveBeenCalled();
    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'login_failure',
        details: expect.objectContaining({
          email: 'admin@school.edu',
          reason: 'invalid_credentials',
        }),
      }),
    );
  });

  it('rejects suspended admin with generic 401 and audits account_suspended', async () => {
    const hash = await bcrypt.hash('valid-admin-password', 4);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'suspended-admin-id',
      email: 'suspended@school.edu',
      authProvider: 'local',
      passwordHash: hash,
      status: 'SUSPENDED',
      assignments: [
        {
          schoolId: 'school-1',
          role: { name: 'SCHOOL_ADMIN', scope: 'school' },
        },
      ],
    });

    await expect(
      service.login(
        'suspended@school.edu',
        'valid-admin-password',
        fakeContext,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(mockSessions.createSession).not.toHaveBeenCalled();
    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'login_failure',
        details: expect.objectContaining({
          email: 'suspended@school.edu',
          reason: 'account_suspended',
        }),
      }),
    );
  });

  it('rejects non-admin user (e.g. STUDENT) with generic 401 and audits not_admin', async () => {
    const hash = await bcrypt.hash('valid-student-password', 4);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'student-id',
      email: 'student@school.edu',
      authProvider: 'local',
      passwordHash: hash,
      status: 'ACTIVE',
      assignments: [
        { schoolId: 'school-1', role: { name: 'STUDENT', scope: 'group' } },
      ],
    });

    await expect(
      service.login(
        'student@school.edu',
        'valid-student-password',
        fakeContext,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(mockSessions.createSession).not.toHaveBeenCalled();
    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'login_failure',
        details: expect.objectContaining({
          email: 'student@school.edu',
          reason: 'not_admin',
        }),
      }),
    );
  });

  it('authenticates active PLATFORM_ADMIN and records login_success audit event', async () => {
    const hash = await bcrypt.hash('platformAdminPassword!', 4);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'platform-admin-id',
      email: 'admin@wamdp.platform',
      authProvider: 'local',
      passwordHash: hash,
      status: 'ACTIVE',
      assignments: [
        {
          schoolId: '00000000-0000-0000-0000-000000000001',
          role: { name: 'PLATFORM_ADMIN', scope: 'platform' },
        },
      ],
    });

    const result = await service.login(
      'admin@wamdp.platform',
      'platformAdminPassword!',
      fakeContext,
    );

    expect(result.accessToken).toBe(fakeTokenPair.accessToken);
    expect(result.refreshToken).toBe(fakeTokenPair.refreshToken);
    expect(mockSessions.createSession).toHaveBeenCalledWith(
      'platform-admin-id',
      fakeContext,
      null,
    );
    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'login_success',
        actor: {
          userId: 'platform-admin-id',
          role: 'PLATFORM_ADMIN',
          schoolId: '00000000-0000-0000-0000-000000000001',
        },
        details: expect.objectContaining({
          method: 'password',
          sessionId: fakeTokenPair.sessionId,
        }),
      }),
    );
  });

  it('authenticates active SCHOOL_ADMIN and passes optional deviceId', async () => {
    const hash = await bcrypt.hash('schoolAdminPassword!', 4);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'school-admin-id',
      email: 'admin@highschool.edu',
      authProvider: 'local',
      passwordHash: hash,
      status: 'ACTIVE',
      assignments: [
        {
          schoolId: 'school-high',
          role: { name: 'SCHOOL_ADMIN', scope: 'school' },
        },
      ],
    });

    const deviceId = 'e2e-device-uuid';
    const result = await service.login(
      'admin@highschool.edu',
      'schoolAdminPassword!',
      fakeContext,
      deviceId,
    );

    expect(result).toBe(fakeTokenPair);
    expect(mockSessions.createSession).toHaveBeenCalledWith(
      'school-admin-id',
      fakeContext,
      deviceId,
    );
    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'login_success',
        actor: {
          userId: 'school-admin-id',
          role: 'SCHOOL_ADMIN',
          schoolId: 'school-high',
        },
      }),
    );
  });

  it('activates an INVITED admin account on first successful login', async () => {
    const hash = await bcrypt.hash('invitedAdminPassword!', 4);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'invited-admin-id',
      email: 'invited-admin@school.edu',
      authProvider: 'local',
      passwordHash: hash,
      status: 'INVITED',
      assignments: [
        {
          schoolId: 'school-1',
          role: { name: 'SCHOOL_ADMIN', scope: 'school' },
        },
      ],
    });
    mockPrisma.user.update.mockResolvedValue({
      id: 'invited-admin-id',
      status: 'ACTIVE',
    });

    const result = await service.login(
      'invited-admin@school.edu',
      'invitedAdminPassword!',
      fakeContext,
    );

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'invited-admin-id' },
      data: { status: 'ACTIVE' },
    });
    expect(result).toBe(fakeTokenPair);
  });

  it('uses context.deviceId when deviceId is not explicitly passed in dto', async () => {
    const hash = await bcrypt.hash('adminPass!', 4);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@school.edu',
      authProvider: 'local',
      passwordHash: hash,
      status: 'ACTIVE',
      assignments: [{ schoolId: 'school-1', role: { name: 'SCHOOL_ADMIN', scope: 'school' } }],
    });

    const contextWithDevice = { ...fakeContext, deviceId: 'context-device-uuid' };
    await service.login('admin@school.edu', 'adminPass!', contextWithDevice);

    expect(mockSessions.createSession).toHaveBeenCalledWith(
      'admin-1',
      contextWithDevice,
      'context-device-uuid',
    );
  });

  it('prefers explicit dto deviceId over context.deviceId', async () => {
    const hash = await bcrypt.hash('adminPass!', 4);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@school.edu',
      authProvider: 'local',
      passwordHash: hash,
      status: 'ACTIVE',
      assignments: [{ schoolId: 'school-1', role: { name: 'SCHOOL_ADMIN', scope: 'school' } }],
    });

    const contextWithDevice = { ...fakeContext, deviceId: 'context-device-uuid' };
    await service.login('admin@school.edu', 'adminPass!', contextWithDevice, 'explicit-device-uuid');

    expect(mockSessions.createSession).toHaveBeenCalledWith(
      'admin-1',
      contextWithDevice,
      'explicit-device-uuid',
    );
  });

  it('locks account after 5 consecutive failed login attempts and audits account_locked', async () => {
    const hash = await bcrypt.hash('CorrectPass123!', 4);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'admin-lockout-test',
      email: 'lockout@school.edu',
      authProvider: 'local',
      passwordHash: hash,
      status: 'ACTIVE',
      assignments: [{ schoolId: 's1', role: { name: 'SCHOOL_ADMIN', scope: 'school' } }],
    });

    service.resetLockout();

    // 4 failed attempts
    for (let i = 0; i < 4; i++) {
      await expect(service.login('lockout@school.edu', 'wrong', fakeContext)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
    expect(mockAudit.record).toHaveBeenCalledTimes(4);

    // 5th failed attempt -> triggers account_locked
    await expect(service.login('lockout@school.edu', 'wrong', fakeContext)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'account_locked',
        details: expect.objectContaining({
          email: 'lockout@school.edu',
          reason: 'too_many_failed_logins',
          failedAttempts: 5,
        }),
      }),
    );

    // 6th attempt even with correct password -> blocked because account is locked
    await expect(service.login('lockout@school.edu', 'CorrectPass123!', fakeContext)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'login_failure',
        details: expect.objectContaining({
          email: 'lockout@school.edu',
          reason: 'account_locked',
        }),
      }),
    );
  });

  it('resets failed attempt counter after a successful login', async () => {
    const hash = await bcrypt.hash('CorrectPass123!', 4);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'admin-reset-test',
      email: 'reset@school.edu',
      authProvider: 'local',
      passwordHash: hash,
      status: 'ACTIVE',
      assignments: [{ schoolId: 's1', role: { name: 'SCHOOL_ADMIN', scope: 'school' } }],
    });

    service.resetLockout();

    // 2 failed attempts
    await expect(service.login('reset@school.edu', 'wrong', fakeContext)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.login('reset@school.edu', 'wrong', fakeContext)).rejects.toBeInstanceOf(UnauthorizedException);

    // 1 successful login
    await service.login('reset@school.edu', 'CorrectPass123!', fakeContext);

    // Next 4 failed attempts should not lock because counter was reset
    for (let i = 0; i < 4; i++) {
      await expect(service.login('reset@school.edu', 'wrong', fakeContext)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }

    // Still not locked
    const isSuccess = await service.login('reset@school.edu', 'CorrectPass123!', fakeContext);
    expect(isSuccess).toBe(fakeTokenPair);
  });

  it('normalizes email to trimmed lowercase before database lookup', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.login('  Admin.Person@School.EDU  ', 'password123!', fakeContext),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'admin.person@school.edu' },
      }),
    );
  });
});
