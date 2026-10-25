import type { Prisma } from '@prisma/client';
import { AUDIT_CHAIN_HEAD_ID, AUDIT_GENESIS_HASH } from '../constants/audit-events.constants.js';
import { verifyAuditChain, type AuditChainVerification } from './audit-hash.util.js';

const VERIFY_BATCH_SIZE = 500;

/**
 * Verifies the chain up to the event audit_chain_head points at, then checks that this event's
 * hash is the head's: a mismatch means the newest event(s) were deleted (or extra ones inserted)
 * outside the app.
 *
 * The head is read FIRST and only events with seq <= head.eventSeq are walked, so events appended
 * while the verification runs are ignored instead of being reported as a broken head. (Appends
 * update the head in the same transaction as the insert, under the head row lock, so every event
 * up to head.eventSeq is committed when the head is read.)
 *
 * Shared with the `npm run audit:verify` script, which has no Nest container.
 */
export async function verifyChainWith(prisma: {
  auditEvent: Pick<Prisma.AuditEventDelegate, 'findMany'>;
  auditChainHead: Pick<Prisma.AuditChainHeadDelegate, 'findUnique'>;
}): Promise<AuditChainVerification> {
  const head = await prisma.auditChainHead.findUnique({ where: { id: AUDIT_CHAIN_HEAD_ID } });
  let result: AuditChainVerification = { valid: true, checkedEvents: 0, headHash: AUDIT_GENESIS_HASH };
  let afterSeq: bigint | undefined;

  for (;;) {
    const batch = await prisma.auditEvent.findMany({
      where: {
        ...(afterSeq !== undefined && { seq: { gt: afterSeq } }),
        ...(head && { AND: [{ seq: { lte: head.eventSeq } }] }),
      },
      orderBy: { seq: 'asc' },
      take: VERIFY_BATCH_SIZE,
    });
    if (batch.length === 0) return checkHead(head, result);

    result = verifyAuditChain(batch, result.headHash, result.checkedEvents);
    if (!result.valid) return result;
    afterSeq = batch[batch.length - 1].seq;
  }
}

function checkHead(
  head: { hash: string; eventSeq: bigint } | null,
  result: AuditChainVerification,
): AuditChainVerification {
  // No head row: database created with `prisma db push`; the chain itself was still verified.
  if (!head || head.hash === result.headHash) return result;
  return {
    ...result,
    valid: false,
    firstInvalid: {
      seq: head.eventSeq.toString(),
      id: 'audit_chain_head',
      reason: 'head_mismatch',
      expected: head.hash,
      actual: result.headHash,
    },
  };
}
