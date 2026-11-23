import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListSpacesQueryDto } from './list-spaces-query.dto.js';

const parse = (query: Record<string, unknown>) => plainToInstance(ListSpacesQueryDto, query);

describe('ListSpacesQueryDto', () => {
  it('trims the search at the validation boundary: "  math  " becomes "math"', () => {
    const dto = parse({ search: '  math  ' });
    expect(dto.search).toBe('math');
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('turns a blank search into an empty string and leaves a missing one undefined', () => {
    expect(parse({ search: '   ' }).search).toBe('');
    expect(parse({}).search).toBeUndefined();
  });

  it('applies the 100-character limit after trimming', () => {
    expect(validateSync(parse({ search: ` ${'a'.repeat(100)} ` }))).toHaveLength(0);
    expect(validateSync(parse({ search: 'a'.repeat(101) }))).not.toHaveLength(0);
  });
});
