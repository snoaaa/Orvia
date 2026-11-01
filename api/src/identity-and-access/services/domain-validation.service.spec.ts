import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DomainValidationService } from './domain-validation.service.js';

describe('DomainValidationService (Unit Tests)', () => {
  let service: DomainValidationService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      school: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
      userAssignment: {
        findMany: vi.fn(),
      },
    };
    service = new DomainValidationService(mockPrisma);
  });

  describe('extractDomain', () => {
    it('extracts and normalizes domain from valid email', () => {
      expect(service.extractDomain('student@harvard.edu')).toBe('harvard.edu');
      expect(service.extractDomain('  User@School.ORG  ')).toBe('school.org');
      expect(service.extractDomain('first.last+tag@sub.domain.edu')).toBe('sub.domain.edu');
      expect(service.extractDomain('student@polytechnique.cm')).toBe('polytechnique.cm');
      expect(service.extractDomain('researcher@cl.cam.ac.uk')).toBe('cl.cam.ac.uk');
      expect(service.extractDomain('eleve@ens-lyon.fr')).toBe('ens-lyon.fr');
      expect(service.extractDomain('admin@tech.academy')).toBe('tech.academy');
    });

    it('returns null for invalid emails or emails without top-level domains', () => {
      expect(service.extractDomain('')).toBeNull();
      expect(service.extractDomain('notanemail')).toBeNull();
      expect(service.extractDomain('user@')).toBeNull();
      expect(service.extractDomain('@domain.com')).toBeNull();
      expect(service.extractDomain('user@localhost')).toBeNull();
    });
  });

  describe('validateDomainForSchool (Issue #9)', () => {
    it('returns allowed: null when school has no configured domains (unrestricted)', async () => {
      mockPrisma.school.findUnique.mockResolvedValue({
        id: 'school-1',
        name: 'Open School',
        domains: [],
      });

      const res = await service.validateDomainForSchool('user@anydomain.com', 'school-1');
      expect(res.allowed).toBeNull();
      expect(res.schoolId).toBe('school-1');
      expect(res.domain).toBe('anydomain.com');
    });

    it('returns allowed: true when email matches one of the school configured domains', async () => {
      mockPrisma.school.findUnique.mockResolvedValue({
        id: 'school-2',
        name: 'Stanford University',
        domains: [{ domain: 'stanford.edu' }, { domain: 'cs.stanford.edu' }],
      });

      const res = await service.validateDomainForSchool('researcher@cs.stanford.edu', 'school-2');
      expect(res.allowed).toBe(true);
      expect(res.schoolId).toBe('school-2');
      expect(res.domain).toBe('cs.stanford.edu');
    });

    it('supports international ccTLDs and arbitrary TLDs (e.g. .cm, .fr, .ac.uk, .academy)', async () => {
      mockPrisma.school.findUnique.mockResolvedValue({
        id: 'school-intl',
        name: 'Ecole Polytechnique de Yaounde',
        domains: [{ domain: 'polytechnique.cm' }],
      });

      const res = await service.validateDomainForSchool('etudiant@polytechnique.cm', 'school-intl');
      expect(res.allowed).toBe(true);
      expect(res.domain).toBe('polytechnique.cm');
    });

    it('allows departmental subdomains when the parent institutional domain is configured', async () => {
      mockPrisma.school.findUnique.mockResolvedValue({
        id: 'school-univ',
        name: 'University of Cambridge',
        domains: [{ domain: 'cam.ac.uk' }],
      });

      const res = await service.validateDomainForSchool('student@cl.cam.ac.uk', 'school-univ');
      expect(res.allowed).toBe(true);
      expect(res.domain).toBe('cl.cam.ac.uk');
    });

    it('prevents domain suffix spoofing (e.g. evilcam.ac.uk is NOT cam.ac.uk)', async () => {
      mockPrisma.school.findUnique.mockResolvedValue({
        id: 'school-univ',
        name: 'University of Cambridge',
        domains: [{ domain: 'cam.ac.uk' }],
      });

      const res = await service.validateDomainForSchool('attacker@evilcam.ac.uk', 'school-univ');
      expect(res.allowed).toBe(false);
      expect(res.domain).toBe('evilcam.ac.uk');
    });

    it('prevents attacker prefix spoofing (e.g. cam.ac.uk.attacker.com is rejected)', async () => {
      mockPrisma.school.findUnique.mockResolvedValue({
        id: 'school-univ',
        name: 'University of Cambridge',
        domains: [{ domain: 'cam.ac.uk' }],
      });

      const res = await service.validateDomainForSchool('attacker@cam.ac.uk.attacker.com', 'school-univ');
      expect(res.allowed).toBe(false);
      expect(res.domain).toBe('cam.ac.uk.attacker.com');
    });

    it('returns allowed: false when email does not match any configured school domain', async () => {
      mockPrisma.school.findUnique.mockResolvedValue({
        id: 'school-2',
        name: 'Stanford University',
        domains: [{ domain: 'stanford.edu' }],
      });

      const res = await service.validateDomainForSchool('outsider@gmail.com', 'school-2');
      expect(res.allowed).toBe(false);
      expect(res.schoolId).toBe('school-2');
      expect(res.domain).toBe('gmail.com');
    });

    it('throws NotFoundException when school does not exist', async () => {
      mockPrisma.school.findUnique.mockResolvedValue(null);

      await expect(
        service.validateDomainForSchool('user@school.edu', 'nonexistent-school'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('validateDomainForUser (Issue #11)', () => {
    it('returns allowed: true when all user schools have no domain restrictions', async () => {
      mockPrisma.school.findMany.mockResolvedValue([
        { id: 's1', domains: [] },
        { id: 's2', domains: [] },
      ]);

      const res = await service.validateDomainForUser('user@personal.org', ['s1', 's2']);
      expect(res.allowed).toBe(true);
    });

    it('returns allowed: true when email domain matches one restricted assigned school (including subdomains)', async () => {
      mockPrisma.school.findMany.mockResolvedValue([
        { id: 's1', domains: [{ domain: 'school-a.edu' }] },
        { id: 's2', domains: [{ domain: 'school-b.cm' }] },
      ]);

      const res1 = await service.validateDomainForUser('student@dept.school-a.edu', ['s1', 's2']);
      expect(res1.allowed).toBe(true);
      expect(res1.matchedSchoolId).toBe('s1');

      const res2 = await service.validateDomainForUser('student@school-b.cm', ['s1', 's2']);
      expect(res2.allowed).toBe(true);
      expect(res2.matchedSchoolId).toBe('s2');
    });

    it('returns allowed: true when user belongs to an unrestricted school alongside a restricted school', async () => {
      mockPrisma.school.findMany.mockResolvedValue([
        { id: 's1', domains: [{ domain: 'school-a.edu' }] },
        { id: 's2', domains: [] }, // unrestricted
      ]);

      const res = await service.validateDomainForUser('student@gmail.com', ['s1', 's2']);
      expect(res.allowed).toBe(true);
      expect(res.matchedSchoolId).toBe('s2');
    });

    it('returns allowed: false when email domain does not match any restricted assigned school', async () => {
      mockPrisma.school.findMany.mockResolvedValue([
        { id: 's1', domains: [{ domain: 'school-a.edu' }] },
      ]);

      const res = await service.validateDomainForUser('intruder@gmail.com', ['s1']);
      expect(res.allowed).toBe(false);
      expect(res.matchedSchoolId).toBeNull();
    });
  });

  describe('validateDomainForGoogleLogin (Issue #11)', () => {
    it('resolves user school assignments and validates domain', async () => {
      mockPrisma.userAssignment.findMany.mockResolvedValue([
        { schoolId: 'school-a' },
      ]);
      mockPrisma.school.findMany.mockResolvedValue([
        { id: 'school-a', domains: [{ domain: 'school-a.edu' }] },
      ]);

      const res = await service.validateDomainForGoogleLogin('user@school-a.edu', 'user-123');
      expect(res.allowed).toBe(true);
      expect(res.matchedSchoolId).toBe('school-a');
    });
  });
});
