import { AUDIT_GENESIS_HASH } from '../constants/audit-events.constants.js';
import { canonicalJson, computeAuditHash, verifyAuditChain, type HashableAuditEvent } from './audit-hash.util.js';

function buildChain(count: number) {
  const events: (HashableAuditEvent & { seq: bigint; hash: string })[] = [];
  let prevHash = AUDIT_GENESIS_HASH;
  for (let i = 0; i < count; i++) {
    const base: HashableAuditEvent = {
      id: `id-${i}`,
      category: 'authentication',
      action: 'login_success',
      actorId: `user-${i}`,
      actorRole: 'STUDENT',
      schoolId: null,
      entityType: 'user',
      entityId: `user-${i}`,
      ip: '127.0.0.1',
      deviceId: null,
      details: { method: 'password', n: i },
      createdAt: new Date(Date.UTC(2026, 9, 18, 10, 0, i)),
      prevHash,
    };
    const hash = computeAuditHash(base);
    events.push({ ...base, seq: BigInt(i + 1), hash });
    prevHash = hash;
  }
  return events;
}

describe('canonicalJson', () => {
  it('does not depend on key order (MySQL JSON columns reorder keys)', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(
      canonicalJson({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }),
    );
  });
});

describe('verifyAuditChain', () => {
  it('accepts an untouched chain', () => {
    expect(verifyAuditChain(buildChain(5))).toMatchObject({ valid: true, checkedEvents: 5 });
  });

  it('detects an edited row', () => {
    const chain = buildChain(5);
    chain[2] = { ...chain[2], ip: '6.6.6.6' };
    expect(verifyAuditChain(chain)).toMatchObject({
      valid: false,
      checkedEvents: 2,
      firstInvalid: { seq: '3', reason: 'hash_mismatch' },
    });
  });

  it('detects edited details', () => {
    const chain = buildChain(3);
    chain[1] = { ...chain[1], details: { n: 1, method: 'google' } };
    expect(verifyAuditChain(chain).firstInvalid?.reason).toBe('hash_mismatch');
  });

  it('detects a deleted row', () => {
    const chain = buildChain(5);
    chain.splice(2, 1);
    expect(verifyAuditChain(chain)).toMatchObject({
      valid: false,
      firstInvalid: { seq: '4', reason: 'broken_link' },
    });
  });

  it('detects an edited row whose hash was recomputed, because the next link breaks', () => {
    const chain = buildChain(4);
    const forged = { ...chain[1], ip: '6.6.6.6' };
    chain[1] = { ...forged, hash: computeAuditHash(forged) };
    expect(verifyAuditChain(chain).firstInvalid).toMatchObject({ seq: '3', reason: 'broken_link' });
  });
});
