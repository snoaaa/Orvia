import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

/**
 * Result of a domain validation check.
 *
 * - `allowed = true`  → the domain is registered and belongs to `schoolId`.
 * - `allowed = false` → the domain is not registered, OR it belongs to a different school.
 * - `allowed = null`  → the school exists but has NO configured domains in `school_domains`;
 *                        by design this means the school does NOT restrict login by domain.
 */
export interface DomainValidationResult {
  /** null = school has no domain config (no restriction applies). */
  allowed: boolean | null;
  /** The school the domain belongs to, if found. */
  schoolId: string | null;
  /** The matched domain record, if any. */
  domain: string | null;
}

/**
 * Shared Domain Validation Service (Issue #9 & #11).
 *
 * Single responsibility: look up a domain string in `school_domains` and decide
 * whether it allows or denies access for a given school.
 *
 * Design rules (Issue #11):
 *   - If a school has NO rows in `school_domains`, the school does NOT restrict
 *     login by domain. This lets schools that have not configured domains yet keep
 *     working without locking anyone out.
 *   - If `school_domains` rows exist for the school but the user's domain is not
 *     among them, login is denied.
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
   * Looks up which school (if any) owns `emailDomain` in `school_domains`,
   * then verifies the user is assigned to that school.
   *
   * Used by Google login (Issue #11) where we only have the email domain and need
   * to find the matching school automatically.
   *
   * Rules:
   *  1. If no school has that domain configured → `allowed: null` (no restriction).
   *  2. Domain found → check that `userId` is assigned to that school.
   *  3. If assigned → `allowed: true`. If not assigned → `allowed: false`.
   */
  async validateDomainForGoogleLogin(
    emailDomain: string,
    userId: string,
  ): Promise<DomainValidationResult> {
    // Look up the domain across all schools.
    const domainRecord = await this.prisma.schoolDomain.findUnique({
      where: { domain: emailDomain },
      select: { domain: true, schoolId: true },
    });

    // No school has this domain configured → no restriction (pass through).
    if (!domainRecord) {
      return { allowed: null, schoolId: null, domain: null };
    }

    // Domain is configured for a school → ensure the user is actually assigned there.
    const assignment = await this.prisma.userAssignment.findFirst({
      where: { userId, schoolId: domainRecord.schoolId },
      select: { id: true },
    });

    if (assignment) {
      return { allowed: true, schoolId: domainRecord.schoolId, domain: domainRecord.domain };
    }
    return { allowed: false, schoolId: domainRecord.schoolId, domain: domainRecord.domain };
  }
}
