/**
 * Sidebar model and the single menu specification for the admin console.
 *
 * Two rules drive what a user sees:
 *   1. `adminTypes` — which console shows the entry (`platform`, `school`, or both when absent).
 *   2. `permission` — the API permission code (prisma/seed.ts) that reveals it, kept here so the
 *      menu can switch to permission filtering as soon as the session exposes `permissions[]`.
 *
 * Navigation is intentionally NOT wired yet: no entry has a `url`, so the sidebar renders labels
 * only and clicking never leaves the current page. `state` records whether the destination
 * already exists (`live`) or still has to be built (`planned`).
 *
 * Icons are Tabler Icons, already bundled with the template (scss/fonts/tabler-icons.min.css);
 * `icon` holds the full class list, e.g. 'ti ti-users'.
 */

/** Which admin console is being rendered. */
export type AdminType = 'platform' | 'school';

/** `live` = the screen exists · `planned` = the destination is not built yet. */
export type NavItemState = 'live' | 'planned';

/** Where the console type is remembered until the real auth session provides it. */
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
  /** Consoles that show it. Absent = both admin types. */
  adminTypes?: AdminType[];
  /** Whether the destination is already built. */
  state?: NavItemState;
}

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
        id: 'users',
        title: 'Users',
        type: 'item',
        classes: 'nav-item',
        url: '/admin/users',
        icon: 'ti ti-users',
        permission: 'users:read',
        state: 'live'
      },
      {
        id: 'invitations',
        title: 'Invitations',
        type: 'item',
        classes: 'nav-item',
        icon: 'ti ti-mail',
        permission: 'users:invite',
        state: 'planned'
      },
      {
        id: 'groups',
        title: 'Groups & classes',
        type: 'item',
        classes: 'nav-item',
        icon: 'ti ti-sitemap',
        permission: 'groups:read',
        state: 'planned'
      },
      {
        id: 'schools',
        title: 'Schools',
        type: 'item',
        classes: 'nav-item',
        icon: 'ti ti-school',
        permission: 'schools:read',
        state: 'live'
      },
      {
        id: 'roles',
        title: 'Roles',
        type: 'item',
        classes: 'nav-item',
        url: '/admin/roles',
        icon: 'ti ti-shield-lock',
        permission: 'users:assign_role',
        adminTypes: ['platform'],
        state: 'live'
      },
      {
        id: 'access-matrix',
        title: 'Access matrix',
        type: 'item',
        classes: 'nav-item',
        icon: 'ti ti-table',
        permission: 'users:assign_role',
        state: 'planned'
      },
      {
        id: 'permissions',
        title: 'Permissions',
        type: 'item',
        classes: 'nav-item',
        icon: 'ti ti-key',
        permission: 'users:assign_role',
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
        icon: 'ti ti-book',
        permission: 'spaces:read',
        state: 'live'
      },
      {
        id: 'documents',
        title: 'Documents',
        type: 'item',
        classes: 'nav-item',
        icon: 'ti ti-file-text',
        permission: 'documents:read',
        state: 'live'
      },
      {
        id: 'processing',
        title: 'Processing queue',
        type: 'item',
        classes: 'nav-item',
        icon: 'ti ti-server',
        permission: 'documents:process',
        state: 'planned'
      },
      {
        id: 'access-rules',
        title: 'Access rules',
        type: 'item',
        classes: 'nav-item',
        icon: 'ti ti-lock',
        permission: 'documents:manage_access',
        state: 'planned'
      },
      {
        id: 'publishing',
        title: 'Publishing',
        type: 'item',
        classes: 'nav-item',
        icon: 'ti ti-upload',
        permission: 'documents:publish',
        state: 'planned'
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
        icon: 'ti ti-messages',
        permission: 'conversations:read',
        state: 'planned'
      },
      {
        id: 'flagged-answers',
        title: 'Flagged answers',
        type: 'item',
        classes: 'nav-item',
        icon: 'ti ti-flag',
        permission: 'answers:report',
        state: 'planned'
      },
      {
        id: 'rag-performance',
        title: 'RAG performance',
        type: 'item',
        classes: 'nav-item',
        icon: 'ti ti-chart-line',
        permission: 'metrics:view',
        adminTypes: ['platform'],
        state: 'planned'
      }
    ]
  },
  {
    id: 'security',
    title: 'Security & Sessions',
    type: 'group',
    children: [
      {
        id: 'sessions',
        title: 'Sessions',
        type: 'item',
        classes: 'nav-item',
        icon: 'ti ti-device-desktop',
        permission: 'users:suspend',
        state: 'planned'
      },
      {
        id: 'devices',
        title: 'Devices',
        type: 'item',
        classes: 'nav-item',
        icon: 'ti ti-device-mobile',
        permission: 'devices:manage',
        state: 'planned'
      },
      {
        id: 'sync',
        title: 'Sync & offline',
        type: 'item',
        classes: 'nav-item',
        icon: 'ti ti-cloud-upload',
        permission: 'sync:execute',
        state: 'planned'
      },
      {
        id: 'audit',
        title: 'Audit trail',
        type: 'item',
        classes: 'nav-item',
        icon: 'ti ti-history',
        permission: 'audit:read',
        state: 'live'
      },
      {
        id: 'audit-export',
        title: 'Audit export',
        type: 'item',
        classes: 'nav-item',
        icon: 'ti ti-download',
        permission: 'audit:export',
        adminTypes: ['platform'],
        state: 'planned'
      }
    ]
  },
  {
    id: 'account',
    title: 'Account',
    type: 'group',
    children: [
      {
        id: 'my-sessions',
        title: 'My sessions',
        type: 'item',
        classes: 'nav-item',
        icon: 'ti ti-device-laptop',
        state: 'live'
      },
      {
        id: 'profile',
        title: 'Profile',
        type: 'item',
        classes: 'nav-item',
        icon: 'ti ti-user',
        state: 'planned'
      }
    ]
  },
  {
    id: 'platform',
    title: 'Platform',
    type: 'group',
    children: [
      {
        id: 'platform-health',
        title: 'Platform health',
        type: 'item',
        classes: 'nav-item',
        icon: 'ti ti-activity',
        permission: 'system:manage',
        adminTypes: ['platform'],
        state: 'planned'
      },
      {
        id: 'settings',
        title: 'Settings',
        type: 'item',
        classes: 'nav-item',
        icon: 'ti ti-settings',
        permission: 'system:manage',
        adminTypes: ['platform'],
        state: 'planned'
      }
    ]
  }
];

/**
 * The entries a given console can see, with groups that end up empty removed
 * (for a school admin, the whole `Platform` group disappears).
 */
export function navigationFor(adminType: AdminType): NavigationItem[] {
  return NavigationItems.map((group) => ({
    ...group,
    children: (group.children ?? []).filter(
      (item) => !item.adminTypes || item.adminTypes.includes(adminType)
    )
  })).filter((group) => (group.children?.length ?? 0) > 0);
}
