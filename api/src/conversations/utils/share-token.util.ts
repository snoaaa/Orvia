import { createHmac, timingSafeEqual } from 'node:crypto';

export interface ShareTokenPayload {
  typ: 'shared_answer';
  mid: string;
  cid: string;
  uid: string;
  exp: number;
}

const DEFAULT_SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function signShareToken(
  input: { messageId: string; conversationId: string; sharedBy: string },
  secret: string,
  ttlMs = DEFAULT_SHARE_TTL_MS,
): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + ttlMs);
  const payload: ShareTokenPayload = {
    typ: 'shared_answer',
    mid: input.messageId,
    cid: input.conversationId,
    uid: input.sharedBy,
    exp: expiresAt.getTime(),
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return { token: `${body}.${sig}`, expiresAt };
}

export function verifyShareToken(token: string, secret: string): ShareTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<ShareTokenPayload>;
    if (
      parsed.typ !== 'shared_answer' ||
      typeof parsed.mid !== 'string' ||
      typeof parsed.cid !== 'string' ||
      typeof parsed.uid !== 'string' ||
      typeof parsed.exp !== 'number'
    ) {
      return null;
    }
    if (parsed.exp <= Date.now()) {
      return null;
    }
    return parsed as ShareTokenPayload;
  } catch {
    return null;
  }
}
