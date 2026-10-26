import { REDACTED, redactSecrets } from './audit-redaction.util.js';

describe('redactSecrets', () => {
  it('redacts secret keys at any depth, keeps the rest', () => {
    const out = redactSecrets({
      email: 'jane@school.edu',
      password: 'hunter2',
      nested: { refreshToken: 'abc', apiKey: 'k', reason: 'invalid_credentials' },
      list: [{ client_secret: 's' }],
    });
    expect(out).toEqual({
      email: 'jane@school.edu',
      password: REDACTED,
      nested: { refreshToken: REDACTED, apiKey: REDACTED, reason: 'invalid_credentials' },
      list: [{ client_secret: REDACTED }],
    });
  });

  it('redacts JWTs, bearer headers and bcrypt hashes under innocent keys', () => {
    const out = redactSecrets({
      note: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln',
      header: 'Bearer abc.def',
      stored: '$2b$12$abcdefghijklmnopqrstuv',
    });
    expect(out).toEqual({ note: REDACTED, header: REDACTED, stored: REDACTED });
  });

  it('does not redact look-alike keys', () => {
    expect(redactSecrets({ passageId: 'p1', footprint: 3 })).toEqual({ passageId: 'p1', footprint: 3 });
  });

  it('drops undefined values and converts dates', () => {
    const date = new Date('2026-10-18T10:00:00.000Z');
    expect(redactSecrets({ a: undefined, at: date })).toEqual({ at: '2026-10-18T10:00:00.000Z' });
  });
});
