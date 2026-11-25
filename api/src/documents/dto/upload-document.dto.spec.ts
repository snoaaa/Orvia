import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { DOCUMENT_FIELD_MAX_LENGTH, DOCUMENT_MAX_TAGS } from './document-metadata.validators.js';
import { UpdateDocumentDto } from './update-document.dto.js';
import { UploadDocumentDto } from './upload-document.dto.js';

async function errorsFor(dtoClass: new () => object, raw: Record<string, unknown>) {
  const dto = plainToInstance(dtoClass, raw);
  return validate(dto);
}

describe('UploadDocumentDto & UpdateDocumentDto (#115)', () => {
  it.each([
    ['UploadDocumentDto', UploadDocumentDto],
    ['UpdateDocumentDto', UpdateDocumentDto],
  ] as const)('%s accepts fields up to 191 chars and 10 normalized tags', async (_name, Dto) => {
    const tags = Array.from({ length: DOCUMENT_MAX_TAGS }, (_, i) => `t${i}`).join(' , ');
    const errors = await errorsFor(Dto, {
      title: `  ${'a'.repeat(DOCUMENT_FIELD_MAX_LENGTH)}  `,
      author: 'b'.repeat(DOCUMENT_FIELD_MAX_LENGTH),
      tags: `${tags}, t0`, // duplicate tag deduplicated to 10
    });
    expect(errors).toEqual([]);
  });

  it.each([
    ['UploadDocumentDto', UploadDocumentDto],
    ['UpdateDocumentDto', UpdateDocumentDto],
  ] as const)('%s rejects title, author, or normalized tags exceeding 191 chars (MySQL VARCHAR)', async (_name, Dto) => {
    expect(await errorsFor(Dto, { title: 'a'.repeat(DOCUMENT_FIELD_MAX_LENGTH + 1) })).toHaveLength(1);
    expect(await errorsFor(Dto, { author: 'b'.repeat(DOCUMENT_FIELD_MAX_LENGTH + 1) })).toHaveLength(1);
    expect(await errorsFor(Dto, { tags: 't'.repeat(DOCUMENT_FIELD_MAX_LENGTH + 1) })).toHaveLength(1);
  });

  it.each([
    ['UploadDocumentDto', UploadDocumentDto],
    ['UpdateDocumentDto', UpdateDocumentDto],
  ] as const)('%s rejects more than 10 distinct tags', async (_name, Dto) => {
    const eleven = Array.from({ length: DOCUMENT_MAX_TAGS + 1 }, (_, i) => `tag${i}`).join(',');
    const errors = await errorsFor(Dto, { tags: eleven });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('tags');
  });
});
