import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AuthConfig } from '../../config/index.js';
import type { AccessTokenPayload } from '../types/authenticated-user.js';

export interface IssuedAccessToken {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

/**
 * Creates and checks access tokens. Login flows (#8 admin login, #10 Google login) and
 * refresh (#12) must issue tokens through `issueAccessToken()` so the guard accepts them.
 * The token only carries the user id: roles, permissions and status are reloaded per request.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async issueAccessToken(userId: string, sessionId?: string): Promise<IssuedAccessToken> {
    const expiresIn = this.config.getOrThrow<AuthConfig>('auth').jwtAccessTtlSeconds;
    const payload: AccessTokenPayload = { sub: userId, type: 'access', ...(sessionId && { sid: sessionId }) };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn });
    return { accessToken, tokenType: 'Bearer', expiresIn };
  }

  /** Returns the payload, or null if the token is malformed, forged, expired or not an access token. */
  async verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
      return payload.type === 'access' && typeof payload.sub === 'string' ? payload : null;
    } catch {
      return null;
    }
  }
}
