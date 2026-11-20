import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { SaveAnswerDto } from './save-answer.dto.js';

describe('SaveAnswerDto (#125)', () => {
  it('accepts a valid messageId UUID', async () => {
    const dto = plainToInstance(SaveAnswerDto, { messageId: '123e4567-e89b-12d3-a456-426614174021' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects missing or non-UUID messageId', async () => {
    expect((await validate(plainToInstance(SaveAnswerDto, {}))).map((e) => e.property)).toEqual(['messageId']);
    expect((await validate(plainToInstance(SaveAnswerDto, { messageId: 'bad-id' }))).map((e) => e.property)).toEqual([
      'messageId',
    ]);
  });
});
