import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface SwaggerAuthOptions {
  user?: string;
  password?: string;
  realm?: string;
}

export function createSwaggerAuthMiddleware(options?: SwaggerAuthOptions) {
  const expectedUser = options?.user || 'admin';
  const expectedPassword = options?.password || 'admin';
  const realm = options?.realm || 'WAMDP API Documentation';

  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', `Basic realm="${realm}"`);
      res.status(401).json({
        statusCode: 401,
        message: 'Unauthorized: Authentication required to access API documentation',
      });
      return;
    }

    try {
      const credentialsBase64 = authHeader.slice(6);
      const credentials = Buffer.from(credentialsBase64, 'base64').toString('utf8');
      const colonIndex = credentials.indexOf(':');

      if (colonIndex === -1) {
        res.setHeader('WWW-Authenticate', `Basic realm="${realm}"`);
        res.status(401).json({
          statusCode: 401,
          message: 'Unauthorized: Invalid credentials format',
        });
        return;
      }

      const user = credentials.slice(0, colonIndex);
      const pass = credentials.slice(colonIndex + 1);

      const userBuffer = Buffer.from(user);
      const expectedUserBuffer = Buffer.from(expectedUser);
      const passBuffer = Buffer.from(pass);
      const expectedPassBuffer = Buffer.from(expectedPassword);

      const userMatch =
        userBuffer.length === expectedUserBuffer.length &&
        timingSafeEqual(userBuffer, expectedUserBuffer);

      const passMatch =
        passBuffer.length === expectedPassBuffer.length &&
        timingSafeEqual(passBuffer, expectedPassBuffer);

      if (userMatch && passMatch) {
        next();
        return;
      }
    } catch {
    }

    res.setHeader('WWW-Authenticate', `Basic realm="${realm}"`);
    res.status(401).json({
      statusCode: 401,
      message: 'Unauthorized: Invalid credentials',
    });
  };
}
