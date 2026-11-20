/**
 * Sidebar model and permission-driven menu specification for the portal (§4.5, Issue #92).
 *
 * Menu visibility is computed strictly from permission codes (`PERMISSION_MENU_MAP` / `item.permission`)
 * without hard-coding role names in components:
 *  - Platform admin: Dashboard, Schools, Users, Roles, Assignments, Spaces, Documents, Conversations, Metrics, Audit.
 *  - School admin: Dashboard, Users, Assignments, Spaces, Documents, Conversations, Metrics, Audit.
 *  - Staff with document-management rights: Spaces, Documents.
 */

/** Which admin console is being rendered (kept for legacy compatibility). */
export type AdminType = 'platform' | 'school';

/** `live` = the screen exists · `planned` = the destination is not built yet. */
export type NavItemState = 'live' | 'planned';

/** Legacy storage key kept for backward compatibility. */
export const ADMIN_TYPE_STORAGE_KEY = 'wamdp.adminType';

export interface NavigationItem {
  id: string;
  title: string;
  type: 'item' | 'collapse' | 'group';
  translate?: string;
  icon?: string;
  hidden?: boolean;
  url?: string;
  classes?: string;
  groupClasses?: string;
  exactMatch?: boolean;
  external?: boolean;
  target?: boolean;
  breadcrumbs?: boolean;
  children?: NavigationItem[];
  link?: string;
  description?: string;
  path?: string;
  /** API permission code that reveals this destination. */
  permission?: string;
  /** Consoles that show it (legacy fallback). */
  adminTypes?: AdminType[];
  /** Whether the destination is already built. */
  state?: NavItemState;
}

/**
 * Permission codes that satisfy a `documents:manage` check (aligned with backend PermissionsGuard).
 */
export const DOCUMENT_MANAGEMENT_PERMISSIONS = new Set<string>([
  'documents:manage',
  'documents.manage',
  'documents:create',
  'documents:update',
  'documents:delete',
  'documents:publish',
  'documents:manage_access',
  'documents:process',
  'documents:access.manage',
  'documents.access.manage',
  'spaces:create',
  'spaces:update',
  'spaces:delete',
  'spaces:manage'
]);

/**
 * Permission-to-menu map (§4.5, Issue #92): maps each portal menu item id to the permission code
 * that grants access to it. No role names are used.
 */
export const PERMISSION_MENU_MAP: Readonly<Record<string, string>> = {
  dashboard: 'metrics:view',
  schools: 'schools:create',
  users: 'users:read',
  roles: 'system:manage',
  assignments: 'users:assign_role',
  spaces: 'documents:manage',
  documents: 'documents:manage',
  conversations: 'metrics:view',
  metrics: 'metrics:view',
  audit: 'audit:read'
};

export const NavigationItems: NavigationItem[] = [
  {
    id: 'overview',
    title: 'Overview',
    type: 'group',
    children: [
      {
        id: 'dashboard',
        title: 'Dashboard',
        type: 'item',
        classes: 'nav-item',
        url: '/admin/dashboard/default',
        icon: 'ti ti-dashboard',
        permission: PERMISSION_MENU_MAP['dashboard'],
        state: 'live'
      }
    ]
  },
  {
    id: 'identity',
    title: 'Identity & Access',
    type: 'group',
    children: [
      {
        id: 'schools',
        title: 'Schools',
        type: 'item',
        classes: 'nav-item',
        url: '/admin/schools',
        icon: 'ti ti-school',
        permission: PERMISSION_MENU_MAP['schools'],
        adminTypes: ['platform'],
        state: 'live'
      },
      {
        id: 'users',
        title: 'Users',
        type: 'item',
        classes: 'nav-item',
        url: '/admin/users',
        icon: 'ti ti-users',
        permission: PERMISSION_MENU_MAP['users'],
        state: 'live'
      },
      {
        id: 'roles',
        title: 'Roles',
        type: 'item',
        classes: 'nav-item',
        url: '/admin/roles',
        icon: 'ti ti-shield-lock',
        permission: PERMISSION_MENU_MAP['roles'],
        adminTypes: ['platform'],
        state: 'live'
      },
      {
        id: 'assignments',
        title: 'Assignments',
        type: 'item',
        classes: 'nav-item',
        url: '/admin/assignments',
        icon: 'ti ti-user-check',
        permission: PERMISSION_MENU_MAP['assignments'],
        state: 'live'
      }
    ]
  },
  {
    id: 'content',
    title: 'Content & Knowledge',
    type: 'group',
    children: [
      {
        id: 'spaces',
        title: 'Spaces',
        type: 'item',
        classes: 'nav-item',
        url: '/admin/spaces',
        icon: 'ti ti-book',
        permission: PERMISSION_MENU_MAP['spaces'],
        state: 'live'
      },
      {
        id: 'documents',
        title: 'Documents',
        type: 'item',
        classes: 'nav-item',
        url: '/admin/documents',
        icon: 'ti ti-file-text',
        permission: PERMISSION_MENU_MAP['documents'],
        state: 'live'
      }
    ]
  },
  {
    id: 'assistant',
    title: 'Assistant & Quality',
    type: 'group',
    children: [
      {
        id: 'conversations',
        title: 'Conversations',
        type: 'item',
        classes: 'nav-item',
        url: '/admin/conversations',
        icon: 'ti ti-messages',
        permission: PERMISSION_MENU_MAP['conversations'],
        state: 'live'
      },
      {
        id: 'metrics',
        title: 'Metrics',
        type: 'item',
        classes: 'nav-item',
        url: '/admin/metrics',
        icon: 'ti ti-chart-line',
        permission: PERMISSION_MENU_MAP['metrics'],
        state: 'live'
      }
    ]
  },
  {
    id: 'security',
    title: 'Security & Sessions',
    type: 'group',
    children: [
      {
        id: 'audit',
        title: 'Audit',
        type: 'item',
        classes: 'nav-item',
        url: '/admin/audit',
        icon: 'ti ti-history',
        permission: PERMISSION_MENU_MAP['audit'],
        state: 'live'
      }
    ]
  }
];

/**
 * Checks whether a set of user permissions satisfies `requiredPermission`
 * (supports '*' wildcard and `documents:manage` / `documents.manage` equivalence).
 */
export function hasMenuPermission(
  userPermissions: readonly string[],
  requiredPermission?: string
): boolean {
  if (!requiredPermission) return true;
  if (userPermissions.includes('*')) return true;
  if (userPermissions.includes(requiredPermission)) return true;

  if (
    requiredPermission === 'documents:manage' ||
    requiredPermission === 'documents.manage' ||
    DOCUMENT_MANAGEMENT_PERMISSIONS.has(requiredPermission)
  ) {
    return userPermissions.some((p) => DOCUMENT_MANAGEMENT_PERMISSIONS.has(p));
  }

  return false;
}

/**
 * Builds the visible sidebar menu purely from the signed-in user's permission codes,
 * stripping out any group whose children are all hidden (#92).
 */
export function navigationForPermissions(userPermissions: readonly string[]): NavigationItem[] {
  return NavigationItems.map((group) => ({
    ...group,
    children: (group.children ?? []).filter((item) =>
      hasMenuPermission(userPermissions, item.permission)
    )
  })).filter((group) => (group.children?.length ?? 0) > 0);
}

/**
 * Legacy helper kept for backward compatibility with older specs.
 */
export function navigationFor(adminType: AdminType): NavigationItem[] {
  return NavigationItems.map((group) => ({
    ...group,
    children: (group.children ?? []).filter(
      (item) => !item.adminTypes || item.adminTypes.includes(adminType)
    )
  })).filter((group) => (group.children?.length ?? 0) > 0);
}
