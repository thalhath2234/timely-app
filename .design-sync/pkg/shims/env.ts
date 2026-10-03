// Runtime gaps between a Next.js app build and a plain browser bundle. Must stay
// the barrel's first import so it runs before any app module evaluates.

// 1. The app reads process.env.NEXT_PUBLIC_* at module scope (Next inlines these at
//    build time); in the browser there is no `process`.
const g = globalThis as unknown as {
  process?: { env: Record<string, string | undefined> };
  React?: Record<string, unknown>;
};
if (!g.process) g.process = { env: {} };

// 2. Overlays wrap content in React's <ViewTransition>, which Next.js gets from its
//    bundled React canary. Stable React 19.2 has no such export, so rendering it
//    would throw "Element type is invalid". It only animates, so a pass-through
//    keeps the rendered output identical.
if (g.React && !g.React.ViewTransition) {
  g.React.ViewTransition = ({ children }: { children?: unknown }) => children ?? null;
}
export {};
