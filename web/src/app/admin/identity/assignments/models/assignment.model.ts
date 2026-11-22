/** Response of POST /assignments and PATCH /assignments/:id. */
export interface AssignmentEntity {
  id: string;
  userId: string;
  schoolId: string;
  schoolName: string;
  groupId: string | null;
  groupName: string | null;
  role: string;
  roleScope: string;
  createdAt: string;
  updatedAt: string;
}

export interface GroupOption {
  id: string;
  schoolId: string;
  name: string;
  type: string;
}

export interface CreateAssignmentPayload {
  userId: string;
  schoolId: string;
  groupId?: string;
  role: string;
}

export interface UpdateAssignmentPayload {
  role?: string;
  /** `null` removes the group. */
  groupId?: string | null;
}

/** Subset of GET /auth/me used to decide what the admin may do. */
export interface CurrentAdmin {
  id: string;
  permissions: string[];
  isPlatformAdmin: boolean;
}
