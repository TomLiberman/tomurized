import { QueryClient } from '@tanstack/react-query';

// Module-level singleton (not created inside a component) so plain .ts modules
// (e.g. games/highScores.ts) can read/patch the cache synchronously.
//
// INVARIANT: synchronous cache reads (queryClient.getQueryData) are only safe
// for keys primed by the boot gate in App.tsx — currently ['subjects'],
// ['settings'], ['progress'] and the active subject's deck/meta.
//
// Defaults are LAN-tuned: the server sits on the same box that serves the SPA,
// so requests either succeed in ~ms or the box is down — fail fast, and lean on
// refetchOnWindowFocus as the cheap cross-device sync (edit on the phone,
// refocus the desktop tab, data refreshes).
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
      retryDelay: 500,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 1,
      retryDelay: 500,
    },
  },
});
