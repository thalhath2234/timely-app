import { backFallback } from "./backFallback";

/**
 * What Android Back does from the current screen:
 * - "pop": something in the app takes it (a stack pops, a tab returns Home);
 * - "up": nothing to pop, so the screen goes to the tab or list it belongs to
 *   (a screen opened from a widget, a shortcut or a notification);
 * - "leave": a true root (Home with no history, or a signed-out screen), so
 *   Android plays its back-to-home animation and leaves the app.
 */
export type BackPlan = { kind: "pop" } | { kind: "up"; href: string } | { kind: "leave" };

export type NavState = { index?: number; routes: { name: string; state?: NavState }[] };

export function backPlan(state: NavState | undefined, canGoBack: boolean): BackPlan {
  if (canGoBack) return { kind: "pop" };
  const names = focusedRoutes(state);
  // Before the navigators mount, let the app take Back: the worst case is
  // React Native's own default (leaving the app), never a skipped screen.
  if (!names.length) return { kind: "pop" };
  if (!names.includes("(app)") || names.includes("(tabs)")) return { kind: "leave" };
  return { kind: "up", href: backFallback(routePath(names)) };
}

/** Route names from the root down to the focused screen. */
export function focusedRoutes(state: NavState | undefined): string[] {
  const names: string[] = [];
  let node = state;
  while (node && node.routes?.length) {
    const route = node.routes[node.index ?? node.routes.length - 1];
    names.push(route.name);
    node = route.state;
  }
  return names;
}

/** "(app)" + "settings/index" -> "/settings"; groups and index segments drop out. */
export function routePath(names: string[]): string {
  const segments = names
    .flatMap((name) => name.split("/"))
    .filter((segment) => segment && !/^\(.+\)$/.test(segment) && segment !== "index");
  return `/${segments.join("/")}`;
}
