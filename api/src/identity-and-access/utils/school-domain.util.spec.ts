import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { assertDomainsAvailable, isValidDomain, normalizeDomain, parseDomainList } from './school-domain.util.js';

describe('school domain utils (#32)', () => {
  it('normalizes case, spaces and a leading @', () => {
    expect(normalizeDomain('  @Lycee-Leclerc.EDU ')).toBe('lycee-leclerc.edu');
  });

  it.each(['school.edu', 'cs.school.edu', 'lycee-leclerc.cm', 'xn--lyce-dpa.fr'])('accepts %s', (domain) => {
    expect(isValidDomain(domain)).toBe(true);
  });

  it.each(['school', 'a..edu', '-x.edu', 'x-.edu', 'user@x.edu', 'http://x.edu', '*.x.edu', 'x.edu.', 'x.123', 'sch ool.edu', 'x_y.edu', ''])(
    'rejects %j',
    (domain) => {
      expect(isValidDomain(domain)).toBe(false);
    },
  );

  it('parses a comma-separated list, normalized and without duplicates', () => {
    expect(parseDomainList(' A.edu, @b.EDU ,a.edu,, ')).toEqual(['a.edu', 'b.edu']);
    expect(parseDomainList('')).toEqual([]);
  });

  it('rejects a list with an invalid domain', () => {
    expect(() => parseDomainList('a.edu,not a domain')).toThrow(BadRequestException);
  });

  describe('assertDomainsAvailable', () => {
    const db = (taken: { domain: string } | null) => ({ schoolDomain: { findFirst: vi.fn().mockResolvedValue(taken) } });

    it('looks for the same domain, its parents and its subdomains in other schools', async () => {
      const client = db(null);
      await assertDomainsAvailable(client as never, ['cs.school.edu'], 'school-a');
      expect(client.schoolDomain.findFirst).toHaveBeenCalledWith({
        where: {
          schoolId: { not: 'school-a' },
          OR: [
            { domain: 'cs.school.edu' },
            { domain: { in: ['school.edu'] } },
            { domain: { endsWith: '.cs.school.edu' } },
          ],
        },
      });
    });

    it('does nothing for an empty list', async () => {
      const client = db(null);
      await assertDomainsAvailable(client as never, []);
      expect(client.schoolDomain.findFirst).not.toHaveBeenCalled();
    });

    it('explains an exact match and an overlap', async () => {
      await expect(assertDomainsAvailable(db({ domain: 'school.edu' }) as never, ['school.edu'])).rejects.toThrow(
        "Domain 'school.edu' is already assigned to another school",
      );
      await expect(assertDomainsAvailable(db({ domain: 'school.edu' }) as never, ['cs.school.edu'])).rejects.toThrow(
        "Domain 'cs.school.edu' overlaps 'school.edu', which belongs to another school",
      );
      await expect(assertDomainsAvailable(db({ domain: 'cs.school.edu' }) as never, ['school.edu'])).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
