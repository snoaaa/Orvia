import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { AskQuestionDto } from './ask-question.dto.js';

const SPACE = '123e4567-e89b-42d3-a456-426614174011';

/** Validates like the global ValidationPipe (whitelist + forbidNonWhitelisted + transform). */
function check(body: Record<string, unknown>) {
  const dto = plainToInstance(AskQuestionDto, body);
  const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, fields: errors.map((e) => e.property) };
}

describe('AskQuestionDto (#119)', () => {
  it('accepts a question, trimmed', () => {
    const { dto, fields } = check({ question: '  How does backpropagation work?  ' });
    expect(fields).toEqual([]);
    expect(dto.question).toBe('How does backpropagation work?');
  });

  it('accepts up to 10 different spaces', () => {
    const spaces = Array.from({ length: 10 }, (_, i) => `123e4567-e89b-42d3-a456-4266141740${String(i).padStart(2, '0')}`);
    expect(check({ question: 'Q', spaceIds: spaces }).fields).toEqual([]);
    expect(check({ question: 'Q', spaceIds: [] }).fields).toEqual([]);
  });

  it.each([
    ['no question', {}],
    ['an empty question', { question: '   ' }],
    ['a question that is not text', { question: 42 }],
    ['a question over 4000 characters', { question: 'x'.repeat(4001) }],
  ])('refuses %s', (_label, body) => {
    expect(check(body).fields).toContain('question');
  });

  it.each([
    ['spaceIds that is not a list', { spaceIds: SPACE }],
    ['an invalid space id', { spaceIds: ['abc'] }],
    ['the same space twice', { spaceIds: [SPACE, SPACE] }],
    ['more than 10 spaces', { spaceIds: Array.from({ length: 11 }, () => SPACE) }],
  ])('refuses %s', (_label, body) => {
    expect(check({ question: 'Q', ...body }).fields).toContain('spaceIds');
  });

  it('compares space ids without case: the same space in two cases is a repeat', () => {
    const upper = SPACE.toUpperCase();
    expect(check({ question: 'Q', spaceIds: [SPACE, upper] }).fields).toContain('spaceIds');
    const { dto, fields } = check({ question: 'Q', spaceIds: [upper] });
    expect(fields).toEqual([]);
    expect(dto.spaceIds).toEqual([SPACE]);
  });

  it.each(['role', 'content', 'modelUsed', 'parameters', 'conversationId'])(
    'refuses %s: the client never chooses it',
    (field) => {
      expect(check({ question: 'Q', [field]: 'assistant' }).fields).toEqual([field]);
    },
  );
});
