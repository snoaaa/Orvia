export type UserStatus = "INVITED" | "ACTIVE" | "SUSPENDED";

export type RoleName =
  | "PLATFORM_ADMIN"
  | "SCHOOL_ADMIN"
  | "CONTENT_MANAGER"
  | "STAFF"
  | "STUDENT"
  | "PARENT_GUEST"
  | (string & {});

export interface AuthRoleAssignment {
  role: RoleName;
  scope: "platform" | "school" | "group" | string;
  schoolId: string;
  schoolName?: string | null;
  schoolStatus?: string | null;
  groupId: string | null;
  permissions: string[];
}

export interface AuthUserSchool {
  id: string;
  name: string;
  status?: string | null;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  status: UserStatus;
  assignments: AuthRoleAssignment[];
  roles?: RoleName[];
  permissions: string[];
  schoolIds: string[];
  schools?: AuthUserSchool[];
  isPlatformAdmin: boolean;
  role: RoleName | null;
  schoolId: string | null;
  sessionId: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  sessionId: string;
  refreshExpiresAt: string;
}
