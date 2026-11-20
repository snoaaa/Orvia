import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CONVERSATION_TITLE_MAX_LENGTH, UpdateConversationDto } from './update-conversation.dto.js';

async function invalidFields(raw: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(UpdateConversationDto, raw);
  const errors = await validate(dto);
  return errors.map((e) => e.property);
}

describe('UpdateConversationDto (#124)', () => {
  it('accepts and trims a valid title', async () => {
    const dto = plainToInstance(UpdateConversationDto, { title: '  Linear Algebra Notes  ' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.title).toBe('Linear Algebra Notes');
  });

  it('rejects empty, whitespace-only, non-string, or missing title', async () => {
    expect(await invalidFields({})).toEqual(['title']);
    expect(await invalidFields({ title: '' })).toEqual(['title']);
    expect(await invalidFields({ title: '   ' })).toEqual(['title']);
    expect(await invalidFields({ title: 123 })).toEqual(['title']);
    expect(await invalidFields({ title: null })).toEqual(['title']);
  });

  it(`rejects title longer than ${CONVERSATION_TITLE_MAX_LENGTH} characters`, async () => {
    expect(await invalidFields({ title: 'a'.repeat(CONVERSATION_TITLE_MAX_LENGTH) })).toEqual([]);
    expect(await invalidFields({ title: 'a'.repeat(CONVERSATION_TITLE_MAX_LENGTH + 1) })).toEqual(['title']);
  });
});
