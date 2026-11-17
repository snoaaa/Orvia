import { describe, expect, it } from 'vitest';
import { ACTIVE_DOCUMENT, ACTIVE_SPACE } from './active-space.util.js';

describe('active space filters (#98)', () => {
  it('ACTIVE_SPACE keeps only spaces that are not soft-deleted', () => {
    expect(ACTIVE_SPACE).toEqual({ deletedAt: null });
  });

  it('ACTIVE_DOCUMENT hides a deleted document and every document of a deleted space', () => {
    expect(ACTIVE_DOCUMENT).toEqual({ deletedAt: null, space: { deletedAt: null } });
    expect(ACTIVE_DOCUMENT.space).toBe(ACTIVE_SPACE);
  });
});
