/**
 * Document spaces of the web portal (#113). Mirrors the API contract of
 * `GET|POST /documents/spaces` and `GET|PATCH|DELETE /documents/spaces/{id}` (#97, #98, #99).
 */

export type SpaceLanguage = 'en' | 'fr';
export type SpacePrivacy = 'public' | 'restricted' | 'private';

/** Same limits as the API (`create-space.dto.ts`). */
export const SPACE_NAME_MAX_LENGTH = 100;
export const SPACE_DESCRIPTION_MAX_LENGTH = 2000;
export const SPACE_SEARCH_MAX_LENGTH = 100;

export const DEFAULT_SPACE_LANGUAGE: SpaceLanguage = 'en';
export const DEFAULT_SPACE_PRIVACY: SpacePrivacy = 'public';

export const SPACE_LANGUAGE_OPTIONS: readonly { value: SpaceLanguage; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'French' }
];

export const SPACE_PRIVACY_OPTIONS: readonly {
  value: SpacePrivacy;
  label: string;
  badgeClass: string;
}[] = [
  {
    value: 'public',
    label: 'Public',
    badgeClass: 'bg-light-success text-success border border-success'
  },
  {
    value: 'restricted',
    label: 'Restricted',
    badgeClass: 'bg-light-warning text-warning border border-warning'
  },
  {
    value: 'private',
    label: 'Private',
    badgeClass: 'bg-light-danger text-danger border border-danger'
  }
];

export interface SpaceEntity {
  id: string;
  schoolId: string | null;
  name: string;
  description: string;
  language: SpaceLanguage;
  privacy: SpacePrivacy;
  createdAt: string;
  updatedAt: string;
}

/** A school offered in the platform admin's school filter and field. */
export interface SchoolOption {
  id: string;
  name: string;
}

export interface PaginatedSpaces {
  data: SpaceEntity[];
  total: number;
  page: number;
  limit: number;
  totalPages?: number;
}

export interface SpaceListFilter {
  page: number;
  limit: number;
  search?: string;
  schoolId?: string;
}

/** Body of `POST /documents/spaces`. */
export interface CreateSpacePayload {
  schoolId: string;
  name: string;
  description?: string;
  language: SpaceLanguage;
  privacy: SpacePrivacy;
}

/** Body of `PATCH /documents/spaces/{id}`: the school of a space cannot change; `null` clears the description. */
export interface UpdateSpacePayload {
  name?: string;
  description?: string | null;
  language?: SpaceLanguage;
  privacy?: SpacePrivacy;
}

/** Fields of the space form that an API error can point at. */
export type SpaceFormField = 'schoolId' | 'name' | 'description' | 'language' | 'privacy';

/** An API error split into messages per form field and a message for the whole form. */
export interface SpaceFormErrors {
  fields: Partial<Record<SpaceFormField, string>>;
  general: string | null;
}

export function spaceLanguageLabel(language: string): string {
  return SPACE_LANGUAGE_OPTIONS.find((o) => o.value === language)?.label ?? language;
}

export function spacePrivacyOption(
  privacy: string
): (typeof SPACE_PRIVACY_OPTIONS)[number] | undefined {
  return SPACE_PRIVACY_OPTIONS.find((o) => o.value === privacy);
}
