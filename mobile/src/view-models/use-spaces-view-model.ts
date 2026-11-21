import type { Space } from "@/models/space";
import { getAccessToken, spaceService } from "@/services";
import { useCallback, useEffect, useState } from "react";
import { useAppSession } from "./app-session-context";

export function useSpacesViewModel() {
  const { user } = useAppSession();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFromCache, setIsFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const cached = await spaceService.getCachedSpaces();
      if (cached.length > 0) {
        setSpaces(cached);
        setIsFromCache(true);
      }
      if (!getAccessToken()) {
        setIsLoading(false);
        return;
      }
      const remote = await spaceService.listVisibleSpaces();
      setSpaces(remote);
      setIsFromCache(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load spaces");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const cached = await spaceService.getCachedSpaces();
        if (active && cached.length > 0) {
          setSpaces(cached);
          setIsFromCache(true);
        }
        if (!getAccessToken()) return;
        const remote = await spaceService.listVisibleSpaces();
        if (active) {
          setSpaces(remote);
          setIsFromCache(false);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load spaces");
        }
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [user?.id]);

  return {
    spaces,
    isLoading,
    isFromCache,
    error,
    refresh,
  };
}
