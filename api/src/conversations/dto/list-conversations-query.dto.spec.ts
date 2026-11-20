import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ListConversationsQueryDto } from './list-conversations-query.dto.js';

async function invalidFields(raw: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(ListConversationsQueryDto, raw);
  const errors = await validate(dto);
  return errors.map((e) => e.property);
}

describe('ListConversationsQueryDto (#123)', () => {
  it('accepts an empty query', async () => {
    expect(await invalidFields({})).toEqual([]);
  });

  it('transforms page and limit to numbers and validates bounds', async () => {
    const dto = plainToInstance(ListConversationsQueryDto, { page: '2', limit: '25' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(25);

    expect(await invalidFields({ page: '0' })).toEqual(['page']);
    expect(await invalidFields({ limit: '0' })).toEqual(['limit']);
    expect(await invalidFields({ limit: '101' })).toEqual(['limit']);
  });

  it('validates spaceId as UUID', async () => {
    expect(await invalidFields({ spaceId: '123e4567-e89b-12d3-a456-426614174011' })).toEqual([]);
    expect(await invalidFields({ spaceId: 'not-a-uuid' })).toEqual(['spaceId']);
  });

  it('trims q and rejects blank or overlong q', async () => {
    const dto = plainToInstance(ListConversationsQueryDto, { q: '  calculus  ' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.q).toBe('calculus');

    expect(await invalidFields({ q: '   ' })).toEqual(['q']);
    expect(await invalidFields({ q: 'a'.repeat(201) })).toEqual(['q']);
  });
});
