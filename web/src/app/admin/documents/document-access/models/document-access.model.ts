/**
 * Access rules of a document (#117, §4.5, §4.7). Mirrors `GET/POST/DELETE /documents/{id}/access`
 * (#109, #110) and `GET /documents/{id}/access/options` (#117).
 */

/** Kinds of target a document can be published to. */
export type AccessTargetType = 'school' | 'role' | 'class' | 'group' | 'user';

/** One publication rule, as listed by the API (the name is already readable). */
export interface AccessRule {
  id: string;
  documentId: string;
  type: AccessTargetType;
  targetId: string;
  targetName: string | null;
  createdAt: string;
}

/** A target to publish to (the body of `POST /documents/{id}/access`). */
export interface AccessTarget {
  type: AccessTargetType;
  id: string;
}

/** An id and its readable name. */
export interface AccessOption {
  id: string;
  name: string;
}

/** What the document's school offers as targets (everything belongs to that school). */
export interface AccessOptions {
  school: AccessOption;
  roles: AccessOption[];
  classes: AccessOption[];
  groups: AccessOption[];
}

export const TARGET_TYPE_LABELS: Record<AccessTargetType, string> = {
  school: 'School',
  role: 'Role',
  class: 'Class',
  group: 'Group',
  user: 'User'
};

/** Name shown for a rule; falls back to the type when the API has no name for the target. */
export function ruleLabel(rule: AccessRule): string {
  return rule.targetName ?? `Unknown ${TARGET_TYPE_LABELS[rule.type].toLowerCase()}`;
}
