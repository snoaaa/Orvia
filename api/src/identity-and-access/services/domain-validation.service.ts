import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

/**
 * Result of a school domain validation check.
 *
 * - `allowed = true`  -> Email domain matches one of the school's configured domains.
 * - `allowed = false` -> School has domain restrictions configured, and email domain is NOT among them.
 * - `allowed = null`  -> School has ZERO configured domains in `school_domains`;
 *                        by specification, this means the school does not restrict by domain (unrestricted).
 */
export interface DomainValidationResult {
  /** null = school has no domain config (no restriction applies). */
  allowed: boolean | null;
  /** The school ID checked. */
  schoolId: string;
  /** The extracted domain string. */
  domain: string;
}

/**
 * Validates email domains against institutional allowed domains in `school_domains` (Issue #9 & #11).
 *
 * Design rules:
 *  - Per-school scoping: A school with zero configured domains does not restrict any domains.
 *  - If a school configures domains, emails matching those domains (or their subdomains) are permitted.
 *  - Prevents confused deputy bypasses by evaluating restrictions strictly against the relevant school(s).
 */
@Injectable()
export class DomainValidationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Extracts the domain part of an email address.
   * Returns null if the email is empty or malformed.
   */
  extractDomain(email: string): string | null {
    if (!email || typeof email !== 'string') return null;
    const trimmed = email.trim().toLowerCase();
    const atIndex = trimmed.lastIndexOf('@');
    if (atIndex <= 0 || atIndex === trimmed.length - 1) return null;
    const domain = trimmed.slice(atIndex + 1);
    return domain.includes('.') ? domain : null;
  }

  /**
   * Validates whether an email domain is permitted for a specific school (Issue #9).
   *
   * Rules:
   *  1. If the school has NO configured domains in `school_domains`, no restriction applies (`allowed: null`).
   *  2. If the school has configured domains and `domain` matches one of them (or is a subdomain), it is allowed (`allowed: true`).
   *  3. If the school has configured domains and `domain` is not among them, it is rejected (`allowed: false`).
   *
   * @throws NotFoundException if schoolId does not exist.
   */
  async validateDomainForSchool(
    domainOrEmail: string,
    schoolId: string,
  ): Promise<DomainValidationResult> {
    const domain = domainOrEmail.includes('@')
      ? this.extractDomain(domainOrEmail)
      : domainOrEmail.trim().toLowerCase();

    if (!domain) {
      return { allowed: false, schoolId, domain: '' };
    }

    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      include: {
        domains: { select: { domain: true } },
      },
    });

    if (!school) {
      throw new NotFoundException(`School with ID '${schoolId}' not found`);
    }

    // A school with no configured domains does NOT restrict by domain (Issue #9 & #11 spec).
    if (school.domains.length === 0) {
      return { allowed: null, schoolId, domain };
    }

    const isMatch = school.domains.some((d) => {
      const allowed = d.domain.trim().toLowerCase();
      return domain === allowed || domain.endsWith(`.${allowed}`);
    });

    return {
      allowed: isMatch,
      schoolId,
      domain,
    };
  }

  /**
   * Validates whether a user's email domain satisfies the domain restrictions of their assigned schools (Issue #11).
   *
   * Rules:
   *  - Examines all schools the user is assigned to.
   *  - If all assigned schools have zero configured domains, login passes (`allowed: true`).
   *  - If assigned schools configure domains, the user's email domain MUST match at least one
   *    of their assigned school's allowed domains (or subdomains), unless they also belong to an unrestricted school.
   */
  async validateDomainForUser(
    domainOrEmail: string,
    schoolIds: string[],
  ): Promise<{ allowed: boolean; matchedSchoolId?: string | null }> {
    const domain = domainOrEmail.includes('@')
      ? this.extractDomain(domainOrEmail)
      : domainOrEmail.trim().toLowerCase();

    if (!domain || schoolIds.length === 0) {
      return { allowed: false, matchedSchoolId: null };
    }

    const schoolsWithDomains = await this.prisma.school.findMany({
      where: { id: { in: schoolIds } },
      include: { domains: { select: { domain: true } } },
    });

    // Schools with configured domains
    const restrictedSchools = schoolsWithDomains.filter(
      (s) => s.domains.length > 0,
    );

    // If none of the user's schools configure domains -> pass through
    if (restrictedSchools.length === 0) {
      return { allowed: true, matchedSchoolId: null };
    }

    // Must match at least one restricted school's configured domain
    const matchedSchool = restrictedSchools.find((s) =>
      s.domains.some((d) => {
        const allowed = d.domain.trim().toLowerCase();
        return domain === allowed || domain.endsWith(`.${allowed}`);
      }),
    );

    if (matchedSchool) {
      return { allowed: true, matchedSchoolId: matchedSchool.id };
    }

    // If user also belongs to an unrestricted school, pass through
    const unrestrictedSchool = schoolsWithDomains.find((s) => s.domains.length === 0);
    if (unrestrictedSchool) {
      return { allowed: true, matchedSchoolId: unrestrictedSchool.id };
    }

    return { allowed: false, matchedSchoolId: null };
  }

  /**
   * Convenience method for Issue #11: Validates Google login email domain against the user's assigned school(s).
   * Resolves the user's school assignments from the database and checks domain validity.
   */
  async validateDomainForGoogleLogin(
    domainOrEmail: string,
    userId: string,
  ): Promise<{ allowed: boolean; matchedSchoolId?: string | null }> {
    const assignments = await this.prisma.userAssignment.findMany({
      where: { userId },
      select: { schoolId: true },
    });
    return this.validateDomainForUser(
      domainOrEmail,
      assignments.map((a) => a.schoolId),
    );
  }
}
