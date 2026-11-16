import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateSpaceDto } from './create-space.dto.js';

const SCHOOL_ID = '123e4567-e89b-42d3-a456-426614174001';

/** Same options as the global ValidationPipe; returns the names of the invalid properties. */
async function invalidFields<T extends object>(cls: new () => T, body: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, body), { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((e) => e.property);
}

describe('CreateSpaceDto (#97)', () => {
  it('accepts a school and a name only', async () => {
    expect(await invalidFields(CreateSpaceDto, { schoolId: SCHOOL_ID, name: 'Mathematics' })).toEqual([]);
  });

  it('accepts every documented language and privacy level', async () => {
    for (const language of ['en', 'fr']) {
      for (const privacy of ['public', 'restricted', 'private']) {
        expect(await invalidFields(CreateSpaceDto, { schoolId: SCHOOL_ID, name: 'Mathematics', language, privacy })).toEqual([]);
      }
    }
  });

  it('trims the name and the description', () => {
    const dto = plainToInstance(CreateSpaceDto, { schoolId: SCHOOL_ID, name: '  Mathematics  ', description: '  Algebra ' });
    expect(dto.name).toBe('Mathematics');
    expect(dto.description).toBe('Algebra');
  });

  it.each([
    ['a missing schoolId', { name: 'Mathematics' }, 'schoolId'],
    ['a schoolId that is not a UUID', { schoolId: 'school-1', name: 'Mathematics' }, 'schoolId'],
    ['a missing name', { schoolId: SCHOOL_ID }, 'name'],
    ['a blank name', { schoolId: SCHOOL_ID, name: '   ' }, 'name'],
    ['a name over 100 characters', { schoolId: SCHOOL_ID, name: 'x'.repeat(101) }, 'name'],
    ['a name that is not a string', { schoolId: SCHOOL_ID, name: 42 }, 'name'],
    ['a description over 2000 characters', { schoolId: SCHOOL_ID, name: 'M', description: 'x'.repeat(2001) }, 'description'],
    ['an unknown language', { schoolId: SCHOOL_ID, name: 'M', language: 'de' }, 'language'],
    ['an unknown privacy level', { schoolId: SCHOOL_ID, name: 'M', privacy: 'secret' }, 'privacy'],
    ['an unknown field', { schoolId: SCHOOL_ID, name: 'M', owner: 'me' }, 'owner'],
  ])('rejects %s', async (_label, body, field) => {
    expect(await invalidFields(CreateSpaceDto, body)).toEqual([field]);
  });
});
