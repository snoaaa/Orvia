import type { Prisma } from '@prisma/client';
import { AUDIT_GENESIS_HASH } from '../constants/audit-events.constants.js';
import { verifyAuditChain, type AuditChainVerification } from './audit-hash.util.js';

const VERIFY_BATCH_SIZE = 500;

/** Shared with the `npm run audit:verify` script, which has no Nest container. */
export async function verifyChainWith(prisma: {
  auditEvent: Pick<Prisma.AuditEventDelegate, 'findMany'>;
}): Promise<AuditChainVerification> {
  let result: AuditChainVerification = { valid: true, checkedEvents: 0, headHash: AUDIT_GENESIS_HASH };
  let afterSeq: bigint | undefined;

  for (;;) {
    const batch = await prisma.auditEvent.findMany({
      where: afterSeq === undefined ? {} : { seq: { gt: afterSeq } },
      orderBy: { seq: 'asc' },
      take: VERIFY_BATCH_SIZE,
    });
    if (batch.length === 0) return result;

    result = verifyAuditChain(batch, result.headHash, result.checkedEvents);
    if (!result.valid) return result;
    afterSeq = batch[batch.length - 1].seq;
  }
}
