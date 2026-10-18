import { createHash } from 'node:crypto';
import { AUDIT_GENESIS_HASH, AUDIT_HASH_VERSION } from '../constants/audit-events.constants.js';

/** The columns covered by the hash. `seq` is excluded because MySQL assigns it. */
export interface HashableAuditEvent {
  id: string;
  category: string;
  action: string;
  actorId: string | null;
  actorRole: string | null;
  schoolId: string | null;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
  deviceId: string | null;
  details: unknown;
  createdAt: Date;
  prevHash: string;
}

/**
 * JSON with object keys sorted recursively, so the same data always gives the same
 * string. Needed because MySQL's JSON column does not preserve key order.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}

/** hash = SHA-256 over the canonical event, which includes prev_hash (the chain link). */
export function computeAuditHash(event: HashableAuditEvent): string {
  const payload = canonicalJson({
    v: AUDIT_HASH_VERSION,
    id: event.id,
    category: event.category,
    action: event.action,
    actorId: event.actorId,
    actorRole: event.actorRole,
    schoolId: event.schoolId,
    entityType: event.entityType,
    entityId: event.entityId,
    ip: event.ip,
    deviceId: event.deviceId,
    details: event.details ?? {},
    createdAt: event.createdAt.toISOString(),
    prevHash: event.prevHash,
  });
  return createHash('sha256').update(payload).digest('hex');
}

export interface AuditChainVerification {
  valid: boolean;
  checkedEvents: number;
  /** Hash of the newest event; keep a copy elsewhere to also detect deletion of the tail. */
  headHash: string;
  firstInvalid?: {
    seq: string;
    id: string;
    reason: 'hash_mismatch' | 'broken_link' | 'head_mismatch';
    expected: string;
    actual: string;
  };
}

/**
 * Walks events in `seq` order and checks every row:
 *  - its hash still matches its content (detects edited rows),
 *  - its prev_hash equals the previous row's hash (detects deleted or inserted rows).
 */
export function verifyAuditChain(
  events: Iterable<HashableAuditEvent & { seq: bigint | string; hash: string }>,
  startPrevHash = AUDIT_GENESIS_HASH,
  alreadyChecked = 0,
): AuditChainVerification {
  let expectedPrev = startPrevHash;
  let checked = alreadyChecked;

  for (const event of events) {
    if (event.prevHash !== expectedPrev) {
      return {
        valid: false,
        checkedEvents: checked,
        headHash: expectedPrev,
        firstInvalid: {
          seq: event.seq.toString(),
          id: event.id,
          reason: 'broken_link',
          expected: expectedPrev,
          actual: event.prevHash,
        },
      };
    }
    const recomputed = computeAuditHash(event);
    if (recomputed !== event.hash) {
      return {
        valid: false,
        checkedEvents: checked,
        headHash: expectedPrev,
        firstInvalid: {
          seq: event.seq.toString(),
          id: event.id,
          reason: 'hash_mismatch',
          expected: recomputed,
          actual: event.hash,
        },
      };
    }
    expectedPrev = event.hash;
    checked++;
  }

  return { valid: true, checkedEvents: checked, headHash: expectedPrev };
}
