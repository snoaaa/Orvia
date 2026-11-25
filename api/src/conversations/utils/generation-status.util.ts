/** Generation states of a message (spec §4.2, #119, #122). */
export const MESSAGE_GENERATION_STATUSES = ['pending', 'generating', 'done', 'failed'] as const;
export type MessageGenerationStatus = (typeof MESSAGE_GENERATION_STATUSES)[number];

/**
 * Normalizes stored message status values (including legacy 'completed'/'streaming') into §4.2 states.
 * The single rule for every route: a missing, empty or unknown status is 'pending'.
 */
export function normalizeGenerationStatus(raw?: string | null): MessageGenerationStatus {
  switch (raw) {
    case 'pending':
      return 'pending';
    case 'generating':
    case 'streaming':
      return 'generating';
    case 'done':
    case 'completed':
      return 'done';
    case 'failed':
    case 'error':
      return 'failed';
    default:
      return 'pending';
  }
}
