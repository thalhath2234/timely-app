import { QueryClient } from "@tanstack/react-query";

/**
 * The app's QueryClient configuration. Mutations use `networkMode: "always"`:
 * TanStack Query must not pause a mutation while the device is offline, because
 * the mutation function is what hands safe changes to the durable offline queue
 * (lib/api/client.ts). A paused mutation lives only in memory and disappears
 * when the app is killed (QA-02). Changes the API does not allow offline still
 * fail immediately with a visible error instead of silently waiting.
 *
 * Queries keep pausing offline. ConnectivityBanner replays the queue and then
 * invalidates every query, so the reconnect refetch is left to it rather than
 * racing the replay with a stale refetch.
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false, refetchOnReconnect: false },
      mutations: { networkMode: "always" },
    },
  });
}
