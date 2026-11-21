export interface Space {
  id: string;
  name: string;
  description?: string | null;
  language?: string | null;
  schoolId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
