import { UnauthorizedException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminLoginService } from '../../../src/auth/services/admin-login.service.js';

/**
 * Unit tests for AdminLoginService (Issue #8).
 * All Prisma, SessionService, and AuditService calls are mocked.
 */
describe('AdminLoginService', () => {
  let service: AdminLoginService;
  let mockPrisma: any;
  let mockSessions: any;
  let mockAudit: any;

  const fakeContext = { ip: '127.0.0.1', userAgent: 'test', deviceId: null };
  const fakeTokenPair = {
    accessToken: 'at.fake',
    refreshToken: 'rt.fake',
    tokenType: 'Bearer' as const,
    expiresIn: 900,
    sessionId: 'session-id',
    refreshExpiresAt: new Date(),
  };

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: vi.fn(),
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

  it('throws 401 for unknown email (no enumeration)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.login('nobody@x.com', 'pass123#', fakeContext)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(mockSessions.createSession).not.toHaveBeenCalled();
  });

  it('throws 401 for wrong password (no enumeration)', async () => {
    // bcrypt hash for 'correct-password'
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('correct-password', 4);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'admin@test.com',
      authProvider: 'local',
      passwordHash: hash,
      status: 'ACTIVE',
      assignments: [{ schoolId: 's1', role: { name: 'SCHOOL_ADMIN', scope: 'school' } }],
    });
    await expect(service.login('admin@test.com', 'wrong-password', fakeContext)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(mockSessions.createSession).not.toHaveBeenCalled();
  });

  it('throws 401 (generic) for a suspended admin account', async () => {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('password123!', 4);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'admin@test.com',
      authProvider: 'local',
      passwordHash: hash,
      status: 'SUSPENDED',
      assignments: [{ schoolId: 's1', role: { name: 'SCHOOL_ADMIN', scope: 'school' } }],
    });
    await expect(service.login('admin@test.com', 'password123!', fakeContext)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(mockSessions.createSession).not.toHaveBeenCalled();
  });

  it('throws 401 for a non-admin user (STUDENT role)', async () => {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('password123!', 4);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u2',
      email: 'student@test.com',
      authProvider: 'local',
      passwordHash: hash,
      status: 'ACTIVE',
      assignments: [{ schoolId: 's1', role: { name: 'STUDENT', scope: 'school' } }],
    });
    await expect(service.login('student@test.com', 'password123!', fakeContext)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws 401 for a google-auth user attempting password login', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u3',
      email: 'user@google.com',
      authProvider: 'google',
      passwordHash: null,
      status: 'ACTIVE',
      assignments: [{ schoolId: 's1', role: { name: 'STUDENT', scope: 'school' } }],
    });
    await expect(service.login('user@google.com', 'password123!', fakeContext)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('returns a token pair for valid SCHOOL_ADMIN credentials', async () => {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('password123!', 4);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u4',
      email: 'admin@school.edu',
      authProvider: 'local',
      passwordHash: hash,
      status: 'ACTIVE',
      assignments: [{ schoolId: 's1', role: { name: 'SCHOOL_ADMIN', scope: 'school' } }],
    });
    const result = await service.login('admin@school.edu', 'password123!', fakeContext);
    expect(result.accessToken).toBe('at.fake');
    expect(result.refreshToken).toBe('rt.fake');
    expect(mockSessions.createSession).toHaveBeenCalledWith('u4', fakeContext);
    expect(mockAudit.record).toHaveBeenCalled();
  });

  it('returns a token pair for valid PLATFORM_ADMIN credentials', async () => {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('adminPass1!', 4);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u5',
      email: 'platform@wamdp.com',
      authProvider: 'local',
      passwordHash: hash,
      status: 'ACTIVE',
      assignments: [{ schoolId: 's1', role: { name: 'PLATFORM_ADMIN', scope: 'platform' } }],
    });
    const result = await service.login('platform@wamdp.com', 'adminPass1!', fakeContext);
    expect(result.sessionId).toBe('session-id');
    expect(mockAudit.record).toHaveBeenCalled();
  });

  it('normalizes email to lowercase before lookup', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.login('ADMIN@School.EDU', 'pass123!', fakeContext)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'admin@school.edu' } }),
    );
  });
});
