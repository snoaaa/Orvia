import { UnauthorizedException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleLoginService } from '../../../src/auth/services/google-login.service.js';

/**
 * Unit tests for GoogleLoginService (Issues #10 and #11).
 *
 * The Google tokeninfo HTTP call is mocked globally so tests run offline.
 */
describe('GoogleLoginService', () => {
  let service: GoogleLoginService;
  let mockPrisma: any;
  let mockSessions: any;
  let mockAudit: any;
  let mockConfig: any;
  let mockDomainValidation: any;

  const fakeContext = { ip: '10.0.0.1', userAgent: 'test-agent', deviceId: null };
  const fakeTokenPair = {
    accessToken: 'at.google',
    refreshToken: 'rt.google',
    tokenType: 'Bearer' as const,
    expiresIn: 900,
    sessionId: 'google-session',
    refreshExpiresAt: new Date(),
  };

  const validPayload = {
    sub: 'google-sub-123',
    email: 'user@school.edu',
    email_verified: true,
    iss: 'accounts.google.com',
    aud: 'test-client-id',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  };

  beforeEach(() => {
    mockPrisma = {
      user: {
        findFirst: vi.fn(),
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
    mockConfig = {
      getOrThrow: vi.fn().mockReturnValue({ googleClientIds: [] }), // empty = dev mode (no audience check)
    };
    mockDomainValidation = {
      extractDomain: vi.fn().mockReturnValue('school.edu'),
      validateDomainForGoogleLogin: vi.fn().mockResolvedValue({ allowed: null, schoolId: null, domain: null }),
    };

    service = new GoogleLoginService(
      mockPrisma,
      mockSessions,
      mockAudit,
      mockConfig,
      mockDomainValidation,
    );

    // Mock global fetch to avoid actual HTTP calls.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => validPayload,
    } as Response);
  });

  it('throws 401 when Google tokeninfo returns an error', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'Bad token' } as Response);
    await expect(service.login('bad-token', fakeContext)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws 401 when email is not verified by Google', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...validPayload, email_verified: false }),
    } as Response);
    await expect(service.login('id-token', fakeContext)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws 401 for an unknown user (not pre-invited)', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.login('id-token', fakeContext)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws 401 for a local (admin) account trying Google login', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'admin@test.com',
      authProvider: 'local',
      passwordHash: '$2b$12$xxx',
      status: 'ACTIVE',
      assignments: [],
    });
    await expect(service.login('id-token', fakeContext)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws 401 for a suspended user', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'u2',
      email: 'user@school.edu',
      authProvider: 'google',
      passwordHash: null,
      status: 'SUSPENDED',
      assignments: [],
    });
    await expect(service.login('id-token', fakeContext)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws 401 when domain restriction is violated (Issue #11)', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'u3',
      email: 'user@school.edu',
      authProvider: 'google',
      passwordHash: null,
      status: 'INVITED',
      assignments: [],
    });
    mockDomainValidation.validateDomainForGoogleLogin.mockResolvedValue({
      allowed: false,
      schoolId: 's1',
      domain: 'school.edu',
    });
    await expect(service.login('id-token', fakeContext)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('succeeds for a returning user (linked google_sub)', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'u4',
      email: 'user@school.edu',
      googleSub: 'google-sub-123',
      authProvider: 'google',
      passwordHash: null,
      status: 'ACTIVE',
      assignments: [{ schoolId: 's1', role: { name: 'STUDENT', scope: 'school' } }],
    });
    mockDomainValidation.validateDomainForGoogleLogin.mockResolvedValue({ allowed: true, schoolId: 's1', domain: 'school.edu' });
    const result = await service.login('id-token', fakeContext);
    expect(result.accessToken).toBe('at.google');
    expect(mockPrisma.user.update).not.toHaveBeenCalled(); // not first login
  });

  it('links google_sub and activates on first login (Issue #10)', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null); // no match by google_sub
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u5',
      email: 'user@school.edu',
      googleSub: null,
      authProvider: 'google',
      passwordHash: null,
      status: 'INVITED',
      assignments: [{ schoolId: 's1', role: { name: 'STUDENT', scope: 'school' } }],
    });
    mockPrisma.user.update.mockResolvedValue({
      id: 'u5',
      email: 'user@school.edu',
      googleSub: 'google-sub-123',
      authProvider: 'google',
      passwordHash: null,
      status: 'ACTIVE',
      assignments: [{ schoolId: 's1', role: { name: 'STUDENT', scope: 'school' } }],
    });
    mockDomainValidation.validateDomainForGoogleLogin.mockResolvedValue({ allowed: null, schoolId: null, domain: null });
    const result = await service.login('id-token', fakeContext);
    expect(result.accessToken).toBe('at.google');
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ googleSub: 'google-sub-123', status: 'ACTIVE' }),
      }),
    );
  });

  it('passes through when school has no domain config (allowed=null) — Issue #11', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'u6',
      email: 'user@anydomain.com',
      googleSub: 'google-sub-xyz',
      authProvider: 'google',
      passwordHash: null,
      status: 'ACTIVE',
      assignments: [{ schoolId: 's2', role: { name: 'STUDENT', scope: 'school' } }],
    });
    // No domain configured for the school → no restriction.
    mockDomainValidation.validateDomainForGoogleLogin.mockResolvedValue({ allowed: null, schoolId: null, domain: null });
    const result = await service.login('id-token', fakeContext);
    expect(result.accessToken).toBe('at.google');
  });
});
