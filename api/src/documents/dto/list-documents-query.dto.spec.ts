import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ListDocumentsQueryDto } from './list-documents-query.dto.js';

describe('ListDocumentsQueryDto tags (#111)', () => {
  const tagsOf = (tags: unknown) => {
    const dto = plainToInstance(ListDocumentsQueryDto, { tags });
    expect(validateSync(dto)).toEqual([]);
    return dto.tags;
  };

  it('splits a comma-separated value', () => {
    expect(tagsOf('math, exam')).toEqual(['math', 'exam']);
  });

  it('splits every value of a repeated parameter', () => {
    expect(tagsOf(['math,exam', 'Physics'])).toEqual(['math', 'exam', 'Physics']);
  });
});
