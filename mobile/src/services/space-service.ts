import type { PaginatedResponse, Space } from "@/models/space";
import { apiClient } from "./api";
import { localStorage } from "./storage";

export const spaceService = {
  async listVisibleSpaces(): Promise<Space[]> {
    const res = await apiClient.get<PaginatedResponse<Space>>("/documents/spaces?limit=100");
    const spaces = res?.data ?? [];
    await localStorage.saveCachedSpaces(spaces);
    return spaces;
  },

  async getCachedSpaces(): Promise<Space[]> {
    return localStorage.getCachedSpaces();
  },
};
