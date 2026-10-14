// "Server-backed useState": the adapter that lets usePortalState swap its
// localStorage-backed useState+useEffect pairs for server persistence WITHOUT
// changing its external interface.
//
//   const [value, setValue, sync] = useServerState({ key, fetcher, saver, defaultValue })
//
// - value: query data (defaultValue while loading / when the server has none)
// - setValue: SetStateAction-compatible; applies OPTIMISTICALLY to the query
//   cache (instant UI, exactly like useState) and schedules a debounced save
//   (400ms). Pending saves flush on unmount
//   and on key change (course switch), bound to the key/saver they were
//   scheduled under — never to the new course's.
// - on save error: resync from the server (invalidate) so the UI never drifts.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { Dispatch, SetStateAction } from 'react';

export interface ServerStateSync {
  isLoading: boolean;
  isSaving: boolean;
  isError: boolean;
  /** Push any pending debounced save immediately. */
  flush: () => void;
}

export interface ServerStateOptions<T> {
  key: QueryKey;
  fetcher: () => Promise<T | null>;
  saver: (value: T) => Promise<unknown>;
  defaultValue: T;
  debounceMs?: number;
  enabled?: boolean;
}

interface PendingSave<T> {
  value: T;
  save: (value: T) => Promise<unknown>;
  key: QueryKey;
}

export function useServerState<T>(
  opts: ServerStateOptions<T>
): [T, Dispatch<SetStateAction<T>>, ServerStateSync] {
  const { key, fetcher, saver, defaultValue, debounceMs = 400, enabled = true } = opts;
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const query = useQuery({
    queryKey: key,
    queryFn: async () => (await fetcher()) ?? defaultValue,
    enabled,
  });

  // Refs so the stable setter/flush callbacks always see current props.
  const latest = useRef({ key, saver, defaultValue });
  latest.current = { key, saver, defaultValue };
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<PendingSave<T> | undefined>(undefined);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const job = pending.current;
    if (!job) return;
    pending.current = undefined;
    setIsSaving(true);
    job
      .save(job.value)
      .then(() => {
        setIsSaving(false);
        setSaveError(false);
      })
      .catch((e) => {
        console.error('[tomurized] save failed for', job.key, e);
        setIsSaving(false);
        setSaveError(true);
        // Resync so optimistic state never silently drifts from the server.
        void queryClient.invalidateQueries({ queryKey: job.key });
      });
  }, [queryClient]);

  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (action) => {
      const { key: k, saver: save, defaultValue: dflt } = latest.current;
      const current = queryClient.getQueryData<T>(k) ?? dflt;
      const next = typeof action === 'function' ? (action as (prev: T) => T)(current) : action;
      queryClient.setQueryData<T>(k, next);
      // Bind the save to the key/saver active NOW — if the key changes before
      // the debounce fires, the flush still writes to the right place.
      pending.current = { value: next, save, key: k };
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, debounceMs);
    },
    [queryClient, flush, debounceMs]
  );

  // Flush pending saves on unmount or key change (course switch mid-debounce).
  const keyHash = JSON.stringify(key);
  useEffect(() => flush, [keyHash, flush]);

  const sync = useMemo<ServerStateSync>(
    () => ({ isLoading: query.isLoading, isSaving, isError: query.isError || saveError, flush }),
    [query.isLoading, query.isError, isSaving, saveError, flush]
  );

  return [(query.data ?? defaultValue) as T, setValue, sync];
}
