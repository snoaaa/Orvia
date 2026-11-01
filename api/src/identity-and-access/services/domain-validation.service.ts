import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

/**
 * Result of a domain validation check.
 *
 * - `allowed = true`  → the domain matches a configured domain for the user's school.
 * - `allowed = false` → at least one of the user's schools has domains configured
 *                       but the user's email domain is not in that school's list → deny.
 * - `allowed = null`  → none of the user's schools have any configured domains;
 *                       by design this means no domain restriction applies.
 */
export interface DomainValidationResult {
  /** null = no school the user belongs to has domain config (no restriction applies). */
  allowed: boolean | null;
  /** The first school that denied access, if any. */
  schoolId: string | null;
  /** The matched domain record, if found. */
  domain: string | null;
}

/**
 * Shared Domain Validation Service (Issue #9 & #11).
 *
 * Single responsibility: validate an email domain against a school's configured
 * allowed domains, enforcing the per-school restriction rule.
 *
 * Design rules (Issue #11):
 *   - Domain restriction is enforced PER-SCHOOL, not globally.
 *   - If a school has NO rows in `school_domains`, the school does NOT restrict
 *     login by domain. This lets schools that have not configured domains yet keep
 *     working without locking anyone out.
 *   - If `school_domains` rows exist for a school and the user's domain is not
 *     among them, login is denied — even if that domain is unknown globally.
 *   - Admin accounts (authProvider = 'local') are never subject to domain checks;
 *     the caller is responsible for skipping the check for those accounts.
 */
@Injectable()
export class DomainValidationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Extracts the domain part of an email address.
   * Returns null if the email is malformed.
   */
  extractDomain(email: string): string | null {
    const parts = email.trim().toLowerCase().split('@');
    if (parts.length !== 2 || !parts[1]) return null;
    return parts[1];
  }

  /**
   * Checks whether `emailDomain` is listed in `school_domains` for `schoolId`.
   *
   * - If the school has no configured domains → returns `{ allowed: null }`.
   *   The caller should treat this as "no restriction" (pass through).
   * - If domains are configured and this domain is among them → `{ allowed: true }`.
   * - If domains are configured but this domain is not found → `{ allowed: false }`.
   */
  async validateDomainForSchool(emailDomain: string, schoolId: string): Promise<DomainValidationResult> {
    const allDomains = await this.prisma.schoolDomain.findMany({
      where: { schoolId },
      select: { domain: true },
    });

    // School has no configured domains → no domain restriction applies.
    if (allDomains.length === 0) {
      return { allowed: null, schoolId, domain: null };
    }

    const match = allDomains.find((d) => d.domain === emailDomain);
    if (match) {
      return { allowed: true, schoolId, domain: match.domain };
    }
    return { allowed: false, schoolId, domain: null };
  }

  /**
   * Validates `emailDomain` against EACH school the user is assigned to.
   *
   * Used by Google login (Issue #11). The restriction is PER-SCHOOL:
   *  1. Load all school assignments for the user (with their school's domain list).
   *  2. For every school that has at least one configured domain, the user's email
   *     domain MUST appear in that school's list. If it doesn't → deny immediately.
   *  3. Schools with zero configured domains are unrestricted — pass through.
   *
   * Why this matters:
   *  - If School A restricts to @school-a.edu, a user invited to School A who logs in
   *    with @gmail.com is REJECTED, even though @gmail.com is not in school_domains
   *    at all. The old global-lookup implementation incorrectly treated an unknown
   *    domain as "no restriction", which completely bypassed domain enforcement.
   *
   * Returns allowed: false at the first school that denies.
   * Returns allowed: true if at least one school matched the domain.
   * Returns allowed: null only when every school the user belongs to has zero
   * configured domains (genuinely unrestricted).
   */
  async validateDomainForGoogleLogin(
    emailDomain: string,
    userId: string,
  ): Promise<DomainValidationResult> {
    // Load the user's school assignments, including each school's domain list.
    const assignments = await this.prisma.userAssignment.findMany({
      where: { userId },
      select: {
        schoolId: true,
        school: {
          select: {
            domains: { select: { domain: true } },
          },
        },
      },
    });

    // No assignments → no school context → no restriction.
    if (assignments.length === 0) {
      return { allowed: null, schoolId: null, domain: null };
    }

    let anySchoolHasDomains = false;

    for (const assignment of assignments) {
      const schoolDomains = assignment.school.domains;

      // School has no configured domains → this school doesn't restrict; continue.
      if (schoolDomains.length === 0) {
        continue;
      }

      anySchoolHasDomains = true;

      // School has domains → the user's email domain MUST be in the list.
      const match = schoolDomains.find((d) => d.domain === emailDomain);
      if (!match) {
        // Reject: school restricts by domain and this domain is not in the list.
        return { allowed: false, schoolId: assignment.schoolId, domain: null };
      }
    }

    // Every school the user belongs to either has no domains (unrestricted)
    // or had this domain in its list.
    return anySchoolHasDomains
      ? { allowed: true, schoolId: null, domain: emailDomain }
      : { allowed: null, schoolId: null, domain: null };
  }
}
