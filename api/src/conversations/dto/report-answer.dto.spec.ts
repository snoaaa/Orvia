import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ReportAnswerDto } from './report-answer.dto.js';

describe('ReportAnswerDto (#125)', () => {
  const validId = '123e4567-e89b-12d3-a456-426614174021';

  it('accepts a valid report and trims reason/feedback', async () => {
    const dto = plainToInstance(ReportAnswerDto, {
      messageId: validId,
      reason: ' hallucination ',
      feedback: '  Wrong formula  ',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.reason).toBe('hallucination');
    expect(dto.feedback).toBe('Wrong formula');
  });

  it('rejects invalid reason, invalid UUID, or overlong feedback', async () => {
    expect(
      (await validate(plainToInstance(ReportAnswerDto, { messageId: validId, reason: 'invalid_reason' }))).map(
        (e) => e.property,
      ),
    ).toEqual(['reason']);

    expect(
      (await validate(plainToInstance(ReportAnswerDto, { messageId: 'bad', reason: 'toxic' }))).map((e) => e.property),
    ).toEqual(['messageId']);

    expect(
      (
        await validate(
          plainToInstance(ReportAnswerDto, { messageId: validId, reason: 'other', feedback: 'a'.repeat(2001) }),
        )
      ).map((e) => e.property),
    ).toEqual(['feedback']);
  });
});
