export type UserStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED';

export interface UserSchoolAssignment {
  schoolId: string;
  roleId: string;
  role?: {
    id: string;
    name: string;
    scope: 'platform' | 'school';
  };
  school?: {
    id: string;
    name: string;
  };
}

export interface UserEntity {
  id: string;
  email: string;
  fullName: string;
  authProvider: string;
  status: UserStatus;
  setupToken?: string | null;
  setupTokenExpiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
  assignments?: UserSchoolAssignment[];
}

export interface PaginatedUsers {
  data: UserEntity[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SessionDevice {
  id: string;
  platform: string;
  lastSyncAt: string;
}

export interface ActiveSession {
  id: string;
  current: boolean;
  device: SessionDevice | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}

export interface UpdateUserPayload {
  email?: string;
  fullName?: string;
  status?: UserStatus;
  schoolId?: string;
}

export interface UserListFilter {
  page: number;
  limit: number;
  status?: string;
  search?: string;
  sortBy?: 'createdAt' | 'email' | 'fullName' | 'status';
  sortOrder?: 'asc' | 'desc';
}

