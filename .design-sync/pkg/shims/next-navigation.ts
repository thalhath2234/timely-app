// Stand-in for next/navigation outside a Next.js app router: navigation is a no-op,
// the pathname comes from window.__TIMELY_PATHNAME__ (default "/today").
const noop = () => undefined;
const router = { push: noop, replace: noop, back: noop, forward: noop, refresh: noop, prefetch: noop };
export function useRouter() { return router; }
export function usePathname(): string {
  return (globalThis as { __TIMELY_PATHNAME__?: string }).__TIMELY_PATHNAME__ ?? "/today";
}
export function useSearchParams() { return new URLSearchParams(); }
export function useParams<T extends Record<string, string | string[]>>() { return {} as T; }
export function useSelectedLayoutSegment() { return null; }
export function useSelectedLayoutSegments() { return [] as string[]; }
export function redirect(_url: string): never { throw new Error("redirect() is unavailable outside Next.js"); }
export function notFound(): never { throw new Error("notFound() is unavailable outside Next.js"); }
