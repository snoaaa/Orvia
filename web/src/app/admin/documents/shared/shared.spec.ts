import { HttpErrorResponse } from '@angular/common/http';
import { FormControl } from '@angular/forms';
import { apiErrorMessages, apiErrorStatus, splitFieldMessages } from './api-error.util';
import {
  maxTags,
  normalizeTagList,
  notBlank,
  tagsMaxLength,
  trimmedMaxLength
} from './form-validators';

describe('documents shared helpers', () => {
  describe('api errors', () => {
    const error = (message: unknown, status = 400) =>
      new HttpErrorResponse({ status, error: { statusCode: status, message } });

    it('reads one or several messages, capitalized', () => {
      expect(apiErrorMessages(error('name should not be empty'))).toEqual([
        'Name should not be empty'
      ]);
      expect(apiErrorMessages(error(['a', '', 3, 'b']))).toEqual(['A', 'B']);
      expect(apiErrorMessages(new HttpErrorResponse({ status: 500, error: new Blob() }))).toEqual(
        []
      );
      expect(apiErrorMessages(new Error('x'))).toEqual([]);
    });

    it('gives the status of HTTP errors only', () => {
      expect(apiErrorStatus(error('x', 409))).toBe(409);
      expect(apiErrorStatus(new Error('x'))).toBeNull();
    });

    it('splits messages by field name', () => {
      expect(
        splitFieldMessages(
          ['Title must be a string', 'Title should not be empty', 'Property foo should not exist'],
          ['title', 'author']
        )
      ).toEqual({
        fields: { title: 'Title must be a string' },
        unmatched: ['Property foo should not exist']
      });
    });
  });

  describe('validators', () => {
    it('notBlank refuses empty or spaces only', () => {
      expect(notBlank(new FormControl('  '))).toEqual({ required: true });
      expect(notBlank(new FormControl(' a '))).toBeNull();
    });

    it('trimmedMaxLength ignores spaces around the value', () => {
      expect(trimmedMaxLength(3)(new FormControl('  abc  '))).toBeNull();
      expect(trimmedMaxLength(3)(new FormControl('abcd'))).toEqual({
        maxlength: { requiredLength: 3, actualLength: 4 }
      });
    });

    it('maxTags counts distinct non-empty tags', () => {
      expect(maxTags(2)(new FormControl('a, A, , b'))).toBeNull();
      expect(maxTags(2)(new FormControl('a,b,c'))).toEqual({ maxTags: { max: 2, actual: 3 } });
    });
  });

  describe('tags as stored', () => {
    it('normalizes like the API', () => {
      expect(normalizeTagList(' math , Math,, exam ')).toBe('math,exam');
    });

    it('limits the stored length (documents.tags is VARCHAR(191))', () => {
      const long = Array.from({ length: 5 }, (_, i) => `${i}${'x'.repeat(39)}`).join(', ');
      expect(normalizeTagList(long).length).toBe(204);
      expect(tagsMaxLength(191)(new FormControl(long))).toEqual({
        tagsMaxLength: { max: 191, actual: 204 }
      });
      expect(tagsMaxLength(191)(new FormControl('math, exam'))).toBeNull();
    });
  });
});
