import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DomainValidationService } from '../../../src/identity-and-access/services/domain-validation.service.js';

/**
 * Unit tests for DomainValidationService (shared by Issue #9 and Issue #11).
 */
describe('DomainValidationService', () => {
  let service: DomainValidationService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      schoolDomain: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
      userAssignment: {
        findMany: vi.fn(),
      },
    };
    service = new DomainValidationService(mockPrisma);
  });

  // ── extractDomain ─────────────────────────────────────────────────────────

  describe('extractDomain', () => {
    it('extracts domain from a valid email', () => {
      expect(service.extractDomain('user@school.edu')).toBe('school.edu');
    });

    it('normalizes to lowercase', () => {
      expect(service.extractDomain('USER@SCHOOL.EDU')).toBe('school.edu');
    });

    it('returns null for an email without @', () => {
      expect(service.extractDomain('notanemail')).toBeNull();
    });

    it('returns null for an email ending with @', () => {
      expect(service.extractDomain('user@')).toBeNull();
    });
  });

  // ── validateDomainForSchool (Issue #9) ────────────────────────────────────

  describe('validateDomainForSchool', () => {
    it('returns allowed=null when school has no configured domains (no restriction)', async () => {
      mockPrisma.schoolDomain.findMany.mockResolvedValue([]);
      const result = await service.validateDomainForSchool('school.edu', 'school-id-1');
      expect(result.allowed).toBeNull();
    });

    it('returns allowed=true when domain is in the school domains list', async () => {
      mockPrisma.schoolDomain.findMany.mockResolvedValue([{ domain: 'school.edu' }]);
      const result = await service.validateDomainForSchool('school.edu', 'school-id-1');
      expect(result.allowed).toBe(true);
      expect(result.domain).toBe('school.edu');
    });

    it('returns allowed=false when domain is not in the school domains list', async () => {
      mockPrisma.schoolDomain.findMany.mockResolvedValue([{ domain: 'other.edu' }]);
      const result = await service.validateDomainForSchool('school.edu', 'school-id-1');
      expect(result.allowed).toBe(false);
      expect(result.domain).toBeNull();
    });
  });

  // ── validateDomainForGoogleLogin (Issue #11) ──────────────────────────────
  //
  // FIXED: The old implementation did a global school_domains lookup, which meant
  // that if @gmail.com was not registered by ANY school, it returned allowed=null
  // ("no restriction"), bypassing domain enforcement entirely.
  //
  // The correct behavior: check the user's ASSIGNED schools. If ANY of those schools
  // has configured domains, the user's email domain MUST match.

  describe('validateDomainForGoogleLogin', () => {
    it('returns allowed=null when user has no school assignments (no restriction)', async () => {
      mockPrisma.userAssignment.findMany.mockResolvedValue([]);
      const result = await service.validateDomainForGoogleLogin('gmail.com', 'user-id');
      expect(result.allowed).toBeNull();
    });

    it('returns allowed=null when all of the user\'s schools have no configured domains', async () => {
      mockPrisma.userAssignment.findMany.mockResolvedValue([
        { schoolId: 's1', school: { domains: [] } },
        { schoolId: 's2', school: { domains: [] } },
      ]);
      const result = await service.validateDomainForGoogleLogin('gmail.com', 'user-id');
      expect(result.allowed).toBeNull();
    });

    it('returns allowed=false when user\'s school has domains configured and email does NOT match — CRITICAL BUG FIX', async () => {
      // This is the exact scenario that was broken: School A restricts to @school-a.edu,
      // user tries to log in with @gmail.com. The old code returned allowed=null because
      // @gmail.com is not in school_domains globally. The correct answer is allowed=false.
      mockPrisma.userAssignment.findMany.mockResolvedValue([
        { schoolId: 's1', school: { domains: [{ domain: 'school-a.edu' }] } },
      ]);
      const result = await service.validateDomainForGoogleLogin('gmail.com', 'user-id');
      expect(result.allowed).toBe(false);
      expect(result.schoolId).toBe('s1');
    });

    it('returns allowed=true when domain matches user\'s school domains', async () => {
      mockPrisma.userAssignment.findMany.mockResolvedValue([
        { schoolId: 's1', school: { domains: [{ domain: 'school.edu' }] } },
      ]);
      const result = await service.validateDomainForGoogleLogin('school.edu', 'user-1');
      expect(result.allowed).toBe(true);
      expect(result.domain).toBe('school.edu');
    });

    it('returns allowed=false when user is assigned to multiple schools and one restricts their domain', async () => {
      // School A: no domain restriction; School B: restricts to @school-b.edu
      // User has @gmail.com → School B denies → result is false
      mockPrisma.userAssignment.findMany.mockResolvedValue([
        { schoolId: 's1', school: { domains: [] } },
        { schoolId: 's2', school: { domains: [{ domain: 'school-b.edu' }] } },
      ]);
      const result = await service.validateDomainForGoogleLogin('gmail.com', 'user-2');
      expect(result.allowed).toBe(false);
      expect(result.schoolId).toBe('s2');
    });

    it('returns allowed=true when user matches all restricting schools', async () => {
      // Both schools restrict to the same domain; user matches both.
      mockPrisma.userAssignment.findMany.mockResolvedValue([
        { schoolId: 's1', school: { domains: [{ domain: 'school.edu' }] } },
        { schoolId: 's2', school: { domains: [{ domain: 'school.edu' }] } },
      ]);
      const result = await service.validateDomainForGoogleLogin('school.edu', 'user-3');
      expect(result.allowed).toBe(true);
    });
  });
});
