import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../database/prisma.service.js';
import { SYSTEM_AUDIT_CONTEXT } from '../utils/audit-request-context.util.js';
import { AuditService } from './audit.service.js';

describe('AuditService.record', () => {
  const client = () => ({
    $queryRaw: vi.fn().mockResolvedValue([{ hash: 'prev' }]),
    $executeRaw: vi.fn(),
    auditEvent: {
      create: vi.fn(async ({ data }) => ({ ...data, seq: 7n, details: data.details })),
    },
    auditChainHead: { update: vi.fn() },
  });
  let prisma: ReturnType<typeof client> & { $transaction: ReturnType<typeof vi.fn> };
  let service: AuditService;
  const input = {
    category: 'document',
    action: 'document_published',
    actor: { userId: 'u1', role: 'CONTENT_MANAGER', schoolId: 's1' },
    entity: { type: 'document', id: 'doc-1' },
    details: {},
    context: SYSTEM_AUDIT_CONTEXT,
  } as unknown as Parameters<AuditService['record']>[0];

  beforeEach(() => {
    prisma = Object.assign(client(), { $transaction: vi.fn() });
    prisma.$transaction.mockImplementation((run: (tx: unknown) => Promise<unknown>) => run(prisma));
    service = new AuditService(prisma as unknown as PrismaService);
  });

  it('opens its own transaction when called alone', async () => {
    await service.record(input);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it("writes inside the caller's transaction when given one", async () => {
    const tx = client();
    await service.record(input, tx as never);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.$queryRaw.mock.calls[0][0].join('?')).toContain('FOR UPDATE');
    expect(tx.auditEvent.create.mock.calls[0][0].data).toMatchObject({ action: 'document_published', prevHash: 'prev' });
    expect(tx.auditChainHead.update).toHaveBeenCalledTimes(1);
  });
});
