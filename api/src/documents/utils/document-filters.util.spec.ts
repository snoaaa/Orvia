import { describe, expect, it } from 'vitest';
import { normalizeTags, parseTags, tagWhere, typeWhere } from './document-filters.util.js';

describe('document filters (#111)', () => {
  it('cleans a tag list: trimmed, no empty tags, each once (case-insensitive)', () => {
    expect(parseTags(' Math , physics,,  ,math, Chem ')).toEqual(['Math', 'physics', 'Chem']);
    expect(normalizeTags(' Math , physics,,  ,math, Chem ')).toBe('Math,physics,Chem');
    expect(normalizeTags('')).toBe('');
    expect(normalizeTags(undefined)).toBe('');
    expect(normalizeTags('machine learning, ai')).toBe('machine learning,ai');
  });

  it('matches a whole tag at any position of the stored list', () => {
    expect(tagWhere('math')).toEqual({
      OR: [
        { tags: 'math' },
        { tags: { startsWith: 'math,' } },
        { tags: { endsWith: ',math' } },
        { tags: { contains: ',math,' } },
      ],
    });
  });

  it('maps each file type to the MIME types uploads store', () => {
    expect(typeWhere('pdf')).toEqual({ mimeType: { in: ['application/pdf'] } });
    expect(typeWhere('image')).toEqual({ mimeType: { startsWith: 'image/' } });
    expect(typeWhere('word')).toEqual({ mimeType: { in: expect.arrayContaining(['application/msword']) } });
    expect(typeWhere('spreadsheet')).toEqual({ mimeType: { in: expect.arrayContaining(['text/csv']) } });
    expect(typeWhere('text')).toEqual({ mimeType: { in: ['text/plain', 'text/markdown'] } });
  });
});
