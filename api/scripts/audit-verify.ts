/**
 * Verifies the audit hash chain (issue #14):  npm run audit:verify
 * Exit code 0 = intact, 1 = tampering detected (usable in CI or a cron job).
 */
import { PrismaClient } from '@prisma/client';
import { verifyChainWith } from '../src/audit/utils/audit-chain.util.js';
import { loadEnv } from './load-env.js';

loadEnv();

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const result = await verifyChainWith(prisma);
    if (result.valid) {
      console.log(`✔ Audit chain intact: ${result.checkedEvents} events verified.`);
      console.log(`  Head hash: ${result.headHash}`);
      return;
    }
    const bad = result.firstInvalid!;
    console.error(`✘ Audit chain BROKEN after ${result.checkedEvents} valid events.`);
    console.error(`  First invalid event: seq=${bad.seq} id=${bad.id}`);
    console.error(
      bad.reason === 'hash_mismatch'
        ? '  Reason: the row content was modified (its hash no longer matches).'
        : '  Reason: an event before it was deleted or inserted (prev_hash does not link).',
    );
    console.error(`  Expected: ${bad.expected}\n  Actual:   ${bad.actual}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
