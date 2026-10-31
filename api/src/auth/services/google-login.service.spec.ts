import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleLoginService, type GoogleTokenPayload } from './google-login.service.js';

describe('GoogleLoginService (Unit Tests)', () => {
  let service: GoogleLoginService;
  let mockPrisma: any;
  let mockSessions: any;
  let mockAudit: any;
  let mockConfig: any;
  let mockDomainValidation: any;

  const fakeContext = { ip: '127.0.0.1', userAgent: 'test-agent', deviceId: null };

  const validPayload: GoogleTokenPayload = {
    sub: 'google-sub-12345',
    email: 'student@school.edu',
    email_verified: true,
    name: 'Student User',
    iss: 'https://accounts.google.com',
    aud: 'client-id-web-123',
    exp: Math.floor(Date.now() / 1000) + 3600,
  };

  const studentUser = {
    id: 'user-student-1',
    email: 'student@school.edu',
    fullName: 'Student User',
    status: 'INVITED' as const,
    authProvider: 'google',
    passwordHash: null,
    googleSub: null,
    assignments: [
      {
        schoolId: 'school-1',
        role: { name: 'STUDENT', scope: 'group' },
        school: { id: 'school-1', name: 'School One' },
      },
    ],
  };

  beforeEach(() => {
    mockPrisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(studentUser),
        update: vi.fn().mockImplementation(({ data }: { data: any }) => ({
          ...studentUser,
          ...data,
          status: data.status || studentUser.status,
          googleSub: data.googleSub || studentUser.googleSub,
        })),
      },
    };

    mockSessions = {
      createSession: vi.fn().mockResolvedValue({
        accessToken: 'access-jwt-mock',
        refreshToken: 'refresh-token-mock',
        sessionId: 'session-uuid-1',
      }),
    };

    mockAudit = {
      record: vi.fn().mockResolvedValue(undefined),
    };

    mockConfig = {
      getOrThrow: vi.fn().mockReturnValue({
        googleClientIds: ['client-id-web-123', 'client-id-mobile-456'],
      }),
    };

    mockDomainValidation = {
      validateDomainForUser: vi.fn().mockResolvedValue({ allowed: true, matchedSchoolId: 'school-1' }),
    };

    service = new GoogleLoginService(
      mockPrisma,
      mockSessions,
      mockAudit,
      mockConfig,
      mockDomainValidation,
    );

    // Spy on verifyGoogleToken by default to return validPayload
    vi.spyOn(service, 'verifyGoogleToken').mockResolvedValue(validPayload);
  });

  describe('Google Token Verification & Audience Checking', () => {
    it('rejects with generic 401 and audits invalid_google_token when verification fails', async () => {
      vi.spyOn(service, 'verifyGoogleToken').mockRejectedValue(new Error('Token signature invalid'));

      await expect(service.login('invalid-token', fakeContext)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'authentication',
          action: 'login_failure',
          details: expect.objectContaining({ reason: 'invalid_google_token' }),
        }),
      );
    });

    it('rejects with generic 401 when token has unverified email (email_verified: false)', async () => {
      vi.spyOn(service, 'verifyGoogleToken').mockResolvedValue({
        ...validPayload,
        email_verified: false,
      });

      await expect(service.login('valid-token', fakeContext)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'authentication',
          action: 'login_failure',
          details: expect.objectContaining({ reason: 'invalid_google_token' }),
        }),
      );
    });
  });

  describe('First-time Login for Invited Users', () => {
    it('activates invited user, links google_sub, creates session, and records login_success', async () => {
      const tokens = await service.login('valid-token', fakeContext, 'device-123');

      expect(tokens).toEqual({
        accessToken: 'access-jwt-mock',
        refreshToken: 'refresh-token-mock',
        sessionId: 'session-uuid-1',
      });

      // Verify DB update
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: studentUser.id },
          data: {
            googleSub: validPayload.sub,
            authProvider: 'google',
            status: 'ACTIVE',
          },
        }),
      );

      // Verify session creation with deviceId
      expect(mockSessions.createSession).toHaveBeenCalledWith(studentUser.id, fakeContext, 'device-123');

      // Verify audit
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'authentication',
          action: 'login_success',
          details: expect.objectContaining({ method: 'google', sessionId: 'session-uuid-1' }),
        }),
      );
    });
  });

  describe('Returning User Login via google_sub', () => {
    it('authenticates returning user via googleSub without updating credentials', async () => {
      const activeReturningUser = {
        ...studentUser,
        status: 'ACTIVE' as const,
        googleSub: validPayload.sub,
      };
      mockPrisma.user.findFirst.mockResolvedValue(activeReturningUser);

      const tokens = await service.login('valid-token', fakeContext);

      expect(tokens.accessToken).toBe('access-jwt-mock');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockSessions.createSession).toHaveBeenCalledWith(activeReturningUser.id, fakeContext, undefined);
    });
  });

  describe('Account Rejections & Defense-in-Depth', () => {
    it('rejects unknown Google account not registered in system (audits unknown_user)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login('valid-token', fakeContext)).rejects.toBeInstanceOf(UnauthorizedException);

      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'authentication',
          action: 'login_failure',
          details: expect.objectContaining({ reason: 'unknown_user' }),
        }),
      );
    });

    it('rejects administrator account with password (audits not_admin)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...studentUser,
        authProvider: 'local',
        passwordHash: '$2b$12$hashedpassword',
        assignments: [
          {
            schoolId: 'school-1',
            role: { name: 'SCHOOL_ADMIN', scope: 'school' },
            school: { id: 'school-1', name: 'School One' },
          },
        ],
      });

      await expect(service.login('valid-token', fakeContext)).rejects.toBeInstanceOf(UnauthorizedException);

      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'authentication',
          action: 'login_failure',
          details: expect.objectContaining({ reason: 'not_admin' }),
        }),
      );
    });

    it('rejects platform administrator account by role even without passwordHash (audits not_admin)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...studentUser,
        authProvider: 'google',
        passwordHash: null,
        assignments: [
          {
            schoolId: 'school-1',
            role: { name: 'PLATFORM_ADMIN', scope: 'platform' },
            school: { id: 'school-1', name: 'School One' },
          },
        ],
      });

      await expect(service.login('valid-token', fakeContext)).rejects.toBeInstanceOf(UnauthorizedException);

      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'authentication',
          action: 'login_failure',
          details: expect.objectContaining({ reason: 'not_admin' }),
        }),
      );
    });

    it('rejects suspended accounts with generic 401 (audits account_suspended)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...studentUser,
        status: 'SUSPENDED' as const,
      });

      await expect(service.login('valid-token', fakeContext)).rejects.toBeInstanceOf(UnauthorizedException);

      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'authentication',
          action: 'login_failure',
          details: expect.objectContaining({ reason: 'account_suspended' }),
        }),
      );
    });

    it('rejects user whose email domain is not allowed for their school (audits domain_not_allowed)', async () => {
      mockDomainValidation.validateDomainForUser.mockResolvedValue({
        allowed: false,
        matchedSchoolId: null,
      });

      await expect(service.login('valid-token', fakeContext)).rejects.toBeInstanceOf(UnauthorizedException);

      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'authentication',
          action: 'login_failure',
          details: expect.objectContaining({ reason: 'domain_not_allowed' }),
        }),
      );
    });

    it('rejects user with no school assignments (audits domain_not_allowed)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...studentUser,
        assignments: [],
      });
      mockDomainValidation.validateDomainForUser.mockResolvedValue({
        allowed: false,
        matchedSchoolId: null,
      });

      await expect(service.login('valid-token', fakeContext)).rejects.toBeInstanceOf(UnauthorizedException);

      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'authentication',
          action: 'login_failure',
          details: expect.objectContaining({ reason: 'domain_not_allowed' }),
        }),
      );
    });

    it('rejects user whose school is deactivated (audits school_deactivated)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...studentUser,
        assignments: [
          {
            schoolId: 'deactivated-school-1',
            role: { name: 'STUDENT', scope: 'group' },
            school: { id: 'deactivated-school-1', name: 'Deactivated School', status: 'deactivated' },
          },
        ],
      });

      await expect(service.login('valid-token', fakeContext)).rejects.toBeInstanceOf(UnauthorizedException);

      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'authentication',
          action: 'login_failure',
          details: expect.objectContaining({
            email: 'student@school.edu',
            reason: 'school_deactivated',
            method: 'google',
          }),
        }),
      );
    });
  });

  describe('Real Token Verification Logic (verifyGoogleToken)', () => {
    it('validates issuer, audience, and expiration from tokeninfo response', async () => {
      // Restore real verifyGoogleToken method
      vi.spyOn(service, 'verifyGoogleToken').mockRestore();

      // Mock fetch
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sub: 'google-sub-789',
          email: 'test@school.edu',
          email_verified: 'true',
          iss: 'https://accounts.google.com',
          aud: 'client-id-web-123',
          exp: Math.floor(Date.now() / 1000) + 1800,
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const payload = await service.verifyGoogleToken('valid-raw-jwt');
      expect(payload.sub).toBe('google-sub-789');
      expect(payload.email).toBe('test@school.edu');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://oauth2.googleapis.com/tokeninfo?id_token=valid-raw-jwt'),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );

      vi.unstubAllGlobals();
    });

    it('throws error when token issuer is invalid', async () => {
      vi.spyOn(service, 'verifyGoogleToken').mockRestore();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sub: 'sub',
          email: 'test@school.edu',
          email_verified: true,
          iss: 'https://attacker-identity.com',
          aud: 'client-id-web-123',
          exp: Math.floor(Date.now() / 1000) + 1800,
        }),
      }));

      await expect(service.verifyGoogleToken('token')).rejects.toThrow(/invalid issuer/i);
      vi.unstubAllGlobals();
    });

    it('throws error when audience does not match configured client IDs', async () => {
      vi.spyOn(service, 'verifyGoogleToken').mockRestore();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sub: 'sub',
          email: 'test@school.edu',
          email_verified: true,
          iss: 'https://accounts.google.com',
          aud: 'foreign-app-client-id',
          exp: Math.floor(Date.now() / 1000) + 1800,
        }),
      }));

      await expect(service.verifyGoogleToken('token')).rejects.toThrow(/does not match configured client IDs/i);
      vi.unstubAllGlobals();
    });

    it('throws error when token is expired', async () => {
      vi.spyOn(service, 'verifyGoogleToken').mockRestore();

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sub: 'sub',
          email: 'test@school.edu',
          email_verified: true,
          iss: 'https://accounts.google.com',
          aud: 'client-id-web-123',
          exp: Math.floor(Date.now() / 1000) - 100, // expired 100s ago
        }),
      }));

      await expect(service.verifyGoogleToken('token')).rejects.toThrow(/expired/i);
      vi.unstubAllGlobals();
    });
  });
});

