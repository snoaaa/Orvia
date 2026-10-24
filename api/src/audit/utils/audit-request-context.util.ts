import type { Request } from 'express';

/** Where an audited action came from. Build it with `auditContextFromRequest(req)`. */
export interface AuditRequestContext {
  ip: string | null;
  deviceId: string | null;
  userAgent: string | null;
  /** Lets AuditService mark the request as audited, so the 403 filter does not log it twice. */
  request?: Request;
}

const AUDITED = Symbol('wamdp.audit.recorded');

export function auditContextFromRequest(req: Request): AuditRequestContext {
  const deviceHeader = req.header('x-device-id');
  const userAgent = req.header('user-agent');
  return {
    ip: normalizeIp(req.ip ?? req.socket?.remoteAddress ?? null),
    deviceId: deviceHeader ? deviceHeader.slice(0, 191) : null,
    userAgent: userAgent ? userAgent.slice(0, 255) : null,
    request: req,
  };
}

/** Context for events raised outside an HTTP request (scheduled jobs, scripts). */
export const SYSTEM_AUDIT_CONTEXT: AuditRequestContext = { ip: null, deviceId: null, userAgent: null };

export function markRequestAudited(req: Request): void {
  (req as unknown as Record<symbol, boolean>)[AUDITED] = true;
}

export function isRequestAudited(req: Request): boolean {
  return (req as unknown as Record<symbol, boolean>)[AUDITED] === true;
}

function normalizeIp(ip: string | null): string | null {
  if (!ip) return null;
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}
