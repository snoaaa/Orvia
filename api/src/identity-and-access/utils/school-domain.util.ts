import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { isFQDN } from 'class-validator';

/** Column size of `school_domains.domain` (VARCHAR(191)). */
export const SCHOOL_DOMAIN_MAX_LENGTH = 191;

/** Options shared by the DTO check and `isValidDomain`: a plain host name with a real top-level part. */
export const SCHOOL_DOMAIN_FQDN_OPTIONS = {
  require_tld: true,
  allow_underscores: false,
  allow_trailing_dot: false,
  allow_numeric_tld: false,
  allow_wildcard: false,
};

/** Trimmed, lowercased, without a leading "@" (`"@Lycee.EDU "` → `"lycee.edu"`). */
export function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, '');
}

export function isValidDomain(domain: string): boolean {
  return domain.length <= SCHOOL_DOMAIN_MAX_LENGTH && isFQDN(domain, SCHOOL_DOMAIN_FQDN_OPTIONS);
}

/** Parses a comma-separated list (`allowedDomains` of POST/PATCH /schools): normalized, deduplicated, 400 if invalid. */
export function parseDomainList(value: string): string[] {
  const domains = [...new Set(value.split(',').map(normalizeDomain).filter((d) => d.length > 0))];
  const invalid = domains.find((d) => !isValidDomain(d));
  if (invalid !== undefined) {
    throw new BadRequestException(`'${invalid}' is not a valid domain (expected something like school.edu)`);
  }
  return domains;
}

/** `cs.school.edu` → `['school.edu']`: the parent domains, without the top-level part alone. */
function parentDomains(domain: string): string[] {
  const labels = domain.split('.');
  return labels.slice(1, -1).map((_, i) => labels.slice(i + 1).join('.'));
}

/**
 * 409 if another school (any school when `schoolId` is omitted) already has one of `domains`, a parent of it,
 * or a subdomain of it: login accepts subdomains, so `school.edu` and `cs.school.edu` in two schools would
 * let one email match both.
 */
export async function assertDomainsAvailable(
  db: Pick<Prisma.TransactionClient, 'schoolDomain'>,
  domains: string[],
  schoolId?: string,
): Promise<void> {
  if (domains.length === 0) return;
  const taken = await db.schoolDomain.findFirst({
    where: {
      ...(schoolId && { schoolId: { not: schoolId } }),
      OR: domains.flatMap((d) => [
        { domain: d },
        { domain: { in: parentDomains(d) } },
        { domain: { endsWith: `.${d}` } },
      ]),
    },
  });
  if (!taken) return;
  if (domains.includes(taken.domain)) {
    throw new ConflictException(`Domain '${taken.domain}' is already assigned to another school`);
  }
  const requested = domains.find((d) => d.endsWith(`.${taken.domain}`) || taken.domain.endsWith(`.${d}`)) ?? domains[0];
  throw new ConflictException(`Domain '${requested}' overlaps '${taken.domain}', which belongs to another school`);
}
