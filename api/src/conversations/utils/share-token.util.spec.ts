import { describe, expect, it } from 'vitest';
import { signShareToken, verifyShareToken } from './share-token.util.js';

describe('share-token.util (#125)', () => {
  const secret = 'test-secret-key';

  it('signs and verifies a valid share token', () => {
    const { token, expiresAt } = signShareToken(
      { messageId: 'msg-1', conversationId: 'conv-1', sharedBy: 'user-1' },
      secret,
    );
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const payload = verifyShareToken(token, secret);
    expect(payload).toMatchObject({
      typ: 'shared_answer',
      mid: 'msg-1',
      cid: 'conv-1',
      uid: 'user-1',
    });
  });

  it('rejects tampered tokens, wrong secret, malformed strings, and expired tokens', () => {
    const { token } = signShareToken(
      { messageId: 'msg-1', conversationId: 'conv-1', sharedBy: 'user-1' },
      secret,
    );
    expect(verifyShareToken(token, 'wrong-secret')).toBeNull();
    expect(verifyShareToken(`${token}x`, secret)).toBeNull();
    expect(verifyShareToken('not.a.valid.token', secret)).toBeNull();
    expect(verifyShareToken('garbage', secret)).toBeNull();

    const expired = signShareToken(
      { messageId: 'msg-1', conversationId: 'conv-1', sharedBy: 'user-1' },
      secret,
      -1000,
    );
    expect(verifyShareToken(expired.token, secret)).toBeNull();
  });
});
