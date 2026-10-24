export const REDACTED = '[REDACTED]';

/** Keys whose values are never stored in audit details, whatever the caller passes. */
const SECRET_KEY_PATTERN =
  /password|passwd|passphrase|^pass$|^pwd$|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|credential|(^|[-_])otp($|[-_])|code[-_]?verifier|signature/i;

/** Values that look like a secret even under an innocent key (JWTs, bearer headers). */
const SECRET_VALUE_PATTERNS = [/^eyJ[\w-]+\.[\w-]+\.[\w-]*$/, /^bearer\s+\S+/i, /^\$2[aby]\$\d{2}\$/];

const MAX_DEPTH = 8;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Returns a JSON-safe copy of `value` with secrets replaced by "[REDACTED]".
 * Undefined values and functions are dropped, Dates become ISO strings, BigInts strings.
 */
export function redactSecrets(value: unknown, depth = 0): JsonValue {
  if (value === null || value === undefined) return null;
  if (depth > MAX_DEPTH) return REDACTED;

  if (typeof value === 'string') {
    return SECRET_VALUE_PATTERNS.some((p) => p.test(value.trim())) ? REDACTED : value;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1));

  if (typeof value === 'object') {
    const out: { [key: string]: JsonValue } = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue;
      out[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactSecrets(v, depth + 1);
    }
    return out;
  }
  return null;
}
