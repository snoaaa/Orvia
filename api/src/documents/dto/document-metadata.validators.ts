import { ValidateBy, buildMessage } from 'class-validator';
import { normalizeTags, parseTags } from '../utils/document-filters.util.js';

/** `documents.title`, `documents.author`, and `documents.tags` are VARCHAR(191) in MySQL. */
export const DOCUMENT_FIELD_MAX_LENGTH = 191;
export const DOCUMENT_MAX_TAGS = 10;

export const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const normalizeTagsTransform = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? normalizeTags(value) : value;

/** Ensures a comma-separated tag string carries at most `max` distinct tags. */
export function MaxTags(max: number) {
  return ValidateBy({
    name: 'maxTags',
    validator: {
      validate: (value: unknown) => typeof value !== 'string' || parseTags(value).length <= max,
      defaultMessage: buildMessage((eachPrefix) => `${eachPrefix}$property must contain at most ${max} tags`),
    },
  });
}
