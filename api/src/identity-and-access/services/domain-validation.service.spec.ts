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
        findFirst: vi.fn(),
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

  describe('validateDomainForGoogleLogin', () => {
    it('returns allowed=null when no school has this domain (no restriction)', async () => {
      mockPrisma.schoolDomain.findUnique.mockResolvedValue(null);
      const result = await service.validateDomainForGoogleLogin('unknown.edu', 'user-id');
      expect(result.allowed).toBeNull();
    });

    it('returns allowed=true when domain matches and user is assigned to that school', async () => {
      mockPrisma.schoolDomain.findUnique.mockResolvedValue({ domain: 'school.edu', schoolId: 's1' });
      mockPrisma.userAssignment.findFirst.mockResolvedValue({ id: 'a1' });
      const result = await service.validateDomainForGoogleLogin('school.edu', 'user-1');
      expect(result.allowed).toBe(true);
      expect(result.schoolId).toBe('s1');
    });

    it('returns allowed=false when domain matches but user is NOT assigned to that school', async () => {
      mockPrisma.schoolDomain.findUnique.mockResolvedValue({ domain: 'school.edu', schoolId: 's1' });
      mockPrisma.userAssignment.findFirst.mockResolvedValue(null);
      const result = await service.validateDomainForGoogleLogin('school.edu', 'user-2');
      expect(result.allowed).toBe(false);
    });
  });
});
