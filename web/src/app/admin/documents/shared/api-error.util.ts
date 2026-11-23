import { HttpErrorResponse } from '@angular/common/http';

/** The message(s) of an API error body (`{ message: string | string[] }`), capitalized. */
export function apiErrorMessages(error: unknown): string[] {
  if (!(error instanceof HttpErrorResponse) || !error.error || typeof error.error !== 'object')
    return [];
  const message = (error.error as { message?: unknown }).message;
  const messages = Array.isArray(message) ? message : [message];
  return messages.filter((m): m is string => typeof m === 'string' && m !== '').map(capitalize);
}

/** HTTP status of an API error, or null for anything else. */
export function apiErrorStatus(error: unknown): number | null {
  return error instanceof HttpErrorResponse ? error.status : null;
}

/**
 * Splits validation messages (400) by form field: a message starting with a field name
 * ("name should not be empty") belongs to that field; the others are for the whole form.
 */
export function splitFieldMessages<F extends string>(
  messages: readonly string[],
  fields: readonly F[]
): { fields: Partial<Record<F, string>>; unmatched: string[] } {
  const byField: Partial<Record<F, string>> = {};
  const unmatched: string[] = [];
  for (const message of messages) {
    const lower = message.toLowerCase();
    const field = fields.find((f) => lower.startsWith(`${f.toLowerCase()} `));
    if (!field) unmatched.push(message);
    else if (!byField[field]) byField[field] = message;
  }
  return { fields: byField, unmatched };
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
