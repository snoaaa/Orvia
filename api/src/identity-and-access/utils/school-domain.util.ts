import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { isFQDN, ValidateBy, type ValidationOptions } from 'class-validator';

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

/** Second-level labels that countries share between many institutions (`edu.cm`, `ac.uk`, `co.za`...). */
const SHARED_SECOND_LEVELS = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org', 'sch']);

/**
 * True for a suffix shared by a whole country, such as `edu.cm` or `ac.uk`: registering it would give one
 * school every `*.edu.cm` address and block all the others.
 */
export function isSharedSuffix(domain: string): boolean {
  const labels = domain.split('.');
  return labels.length === 2 && SHARED_SECOND_LEVELS.has(labels[0]) && /^[a-z]{2}$/.test(labels[1]);
}

export function isValidDomain(domain: string): boolean {
  return (
    domain.length <= SCHOOL_DOMAIN_MAX_LENGTH && isFQDN(domain, SCHOOL_DOMAIN_FQDN_OPTIONS) && !isSharedSuffix(domain)
  );
}

export const INVALID_DOMAIN_MESSAGE = 'must be a domain name such as school.edu (not a shared suffix such as edu.cm)';

/** DTO check matching `isValidDomain`. */
export function IsSchoolDomain(validationOptions?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isSchoolDomain',
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isValidDomain(value),
        defaultMessage: () => `domain ${INVALID_DOMAIN_MESSAGE}`,
      },
    },
    validationOptions,
  );
}

/** Parses a comma-separated list (`allowedDomains` of POST/PATCH /schools): normalized, deduplicated, 400 if invalid. */
export function parseDomainList(value: string | null | undefined): string[] {
  // `null` (allowed by @IsOptional) clears the list, like an empty string.
  if (!value) return [];
  const domains = [...new Set(value.split(',').map(normalizeDomain).filter((d) => d.length > 0))];
  const invalid = domains.find((d) => !isValidDomain(d));
  if (invalid !== undefined) {
    throw new BadRequestException(`'${invalid}' ${INVALID_DOMAIN_MESSAGE}`);
  }
  return domains;
}

/** `cs.school.edu` → `['school.edu']`: the parent domains, without the top-level part alone. */
export function parentDomains(domain: string): string[] {
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
