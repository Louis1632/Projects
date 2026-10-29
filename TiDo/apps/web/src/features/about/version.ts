import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

export interface BuildInfo {
  version: string;
  revision: string;
  /** ISO timestamp. */
  builtAt: string;
}

// Injected by vite.config.ts at build time.
declare const __TIDO_BUILD__: BuildInfo;
export const buildInfo: BuildInfo = __TIDO_BUILD__;

const SEEN_KEY = 'tido.seenVersion';

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function writeSeen(version: string) {
  try {
    localStorage.setItem(SEEN_KEY, version);
  } catch {
    // Storage can be unavailable (private mode); the badge then simply shows again.
  }
}

/**
 * Whether this browser has opened What's new since the running version shipped. A first
 * visit counts as seen, so new people are not greeted with a badge for the release they
 * started on.
 */
export function useVersionSeen(): { unseen: boolean; markSeen: () => void } {
  const [seen, setSeen] = useState(() => {
    const stored = readSeen();
    if (stored === null) writeSeen(buildInfo.version);
    return stored ?? buildInfo.version;
  });
  const markSeen = useCallback(() => {
    writeSeen(buildInfo.version);
    setSeen(buildInfo.version);
  }, []);
  return { unseen: seen !== buildInfo.version, markSeen };
}

/** True once the server has a different build from the one running in this tab. */
export function useNewerBuildAvailable(): boolean {
  const { data } = useQuery({
    queryKey: ['version-file'],
    queryFn: async (): Promise<BuildInfo | null> => {
      const response = await fetch('/version.json', { cache: 'no-store' });
      // The dev server has no version.json; there is nothing to compare against.
      if (!response.ok) return null;
      return (await response.json()) as BuildInfo;
    },
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  return !!data && data.revision !== buildInfo.revision;
}
