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
