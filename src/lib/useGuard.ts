import { useCallback, useRef } from 'react';

/**
 * Run an async action at most once at a time. A double-click fires the handler
 * twice before React re-renders, so `disabled` props and "loading" state flags
 * can't stop the second call (it created duplicate courses, chat messages…).
 * A ref flips synchronously, so the re-entrant call is simply ignored.
 */
export function useGuard() {
  const busy = useRef(false);
  return useCallback(async <T>(action: () => Promise<T>): Promise<T | undefined> => {
    if (busy.current) return undefined;
    busy.current = true;
    try {
      return await action();
    } finally {
      busy.current = false;
    }
  }, []);
}
