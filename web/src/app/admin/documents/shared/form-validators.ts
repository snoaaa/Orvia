import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/** Required, ignoring spaces around the value (the API trims it). */
export const notBlank: ValidatorFn = (control: AbstractControl): ValidationErrors | null =>
  typeof control.value === 'string' && control.value.trim() === '' ? { required: true } : null;

/** Maximum length of the trimmed value, like the API. */
export function trimmedMaxLength(max: number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const length = typeof control.value === 'string' ? control.value.trim().length : 0;
    return length > max ? { maxlength: { requiredLength: max, actualLength: length } } : null;
  };
}

/** A tag list the way the API stores it: trimmed, no empty ones, each kept once (first spelling). */
export function normalizeTagList(raw: string): string {
  const seen = new Set<string>();
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (!tag || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(',');
}

/**
 * The tags as stored (`normalizeTagList`) fit in `max` characters: `documents.tags` is VARCHAR(191) and
 * longer values make the API fail.
 */
export function tagsMaxLength(max: number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    if (typeof control.value !== 'string') return null;
    const length = normalizeTagList(control.value).length;
    return length > max ? { tagsMaxLength: { max, actual: length } } : null;
  };
}

/** At most `max` comma-separated tags (empty ones and repeats ignored, like the API). */
export function maxTags(max: number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    if (typeof control.value !== 'string') return null;
    const tags = new Set(
      control.value
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
    );
    return tags.size > max ? { maxTags: { max, actual: tags.size } } : null;
  };
}
