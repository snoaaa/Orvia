export type RoleScope = 'platform' | 'school' | 'group';

export interface RoleEntity {
  id: string;
  name: string;
  scope: RoleScope;
  permissions?: string[];
  assignedUsersCount?: number;
  isBase?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PermissionEntity {
  code: string;
  description: string | null;
  roles?: string[];
  holdersTotal?: number;
}

export interface GroupedPermissionCategory {
  key: string;
  title: string;
  icon: string;
  description: string;
  permissions: PermissionEntity[];
}

export interface CreateRolePayload {
  name: string;
  scope: RoleScope;
  permissions: string[];
}

export interface UpdateRolePayload {
  name?: string;
  scope?: RoleScope;
  permissions?: string[];
}

export interface RoleFilter {
  search: string;
  scope: 'ALL' | RoleScope;
  type: 'ALL' | 'BASE' | 'CUSTOM';
}

export const BASE_ROLE_NAMES = [
  'PLATFORM_ADMIN',
  'SCHOOL_ADMIN',
  'CONTENT_MANAGER',
  'STAFF',
  'STUDENT',
  'PARENT_GUEST'
] as const;

export function isSystemBaseRole(roleName: string | undefined | null): boolean {
  if (!roleName) return false;
  const upper = roleName.trim().toUpperCase();
  return (BASE_ROLE_NAMES as readonly string[]).includes(upper);
}

