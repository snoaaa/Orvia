import type { Prisma } from '@prisma/client';
import { AUDIT_CHAIN_HEAD_ID, AUDIT_GENESIS_HASH } from '../constants/audit-events.constants.js';
import { verifyAuditChain, type AuditChainVerification } from './audit-hash.util.js';

const VERIFY_BATCH_SIZE = 500;

/**
 * Walks the whole chain, then checks that audit_chain_head points at the newest event:
 * a mismatch means the newest event(s) were deleted (or extra ones inserted) outside the app.
 * Shared with the `npm run audit:verify` script, which has no Nest container.
 */
export async function verifyChainWith(prisma: {
  auditEvent: Pick<Prisma.AuditEventDelegate, 'findMany'>;
  auditChainHead: Pick<Prisma.AuditChainHeadDelegate, 'findUnique'>;
}): Promise<AuditChainVerification> {
  let result: AuditChainVerification = { valid: true, checkedEvents: 0, headHash: AUDIT_GENESIS_HASH };
  let afterSeq: bigint | undefined;

  for (;;) {
    const batch = await prisma.auditEvent.findMany({
      where: afterSeq === undefined ? {} : { seq: { gt: afterSeq } },
      orderBy: { seq: 'asc' },
      take: VERIFY_BATCH_SIZE,
    });
    if (batch.length === 0) return checkHead(prisma, result);

    result = verifyAuditChain(batch, result.headHash, result.checkedEvents);
    if (!result.valid) return result;
    afterSeq = batch[batch.length - 1].seq;
  }
}

async function checkHead(
  prisma: { auditChainHead: Pick<Prisma.AuditChainHeadDelegate, 'findUnique'> },
  result: AuditChainVerification,
): Promise<AuditChainVerification> {
  const head = await prisma.auditChainHead.findUnique({ where: { id: AUDIT_CHAIN_HEAD_ID } });
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
