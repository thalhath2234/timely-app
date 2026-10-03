// In-browser stand-in for the Timely REST API. Data-bound components call the
// API through apps/web/app/utils/api/client.ts (`fetch("/api-proxy/<path>")`);
// TimelyProvider routes those requests here so the components render with data
// outside the running app. Requests to any other URL go to the real fetch.

export type MockRequest = {
  method: string;
  /** API path without the /api-proxy prefix or query string, e.g. "/tasks/t_1". */
  path: string;
  /** Values of `:name` segments in the matched route. */
  params: Record<string, string>;
  query: URLSearchParams;
  /** Parsed JSON body (undefined when absent or not JSON). */
  body: unknown;
};

/** A route's response: a JSON value, a `Blob` (served with its own type, e.g.
 *  an image), a ready `Response`, or a function of the request returning any of
 *  these. `undefined` answers 404. */
export type MockHandler = unknown | ((req: MockRequest) => unknown);

/**
 * Route table. Keys are `"METHOD /path"` or `"/path"` (any method); `:name`
 * segments match one path segment. e.g. `{ "GET /tasks": [...], "/tasks/:id": (r) => ... }`.
 */
export type TimelyMockApi = Record<string, MockHandler>;

const API_PREFIX = "/api-proxy";

type Route = { method: string | null; parts: string[]; handler: MockHandler };

function compile(api: TimelyMockApi): Route[] {
  return Object.entries(api).map(([key, handler]) => {
    const m = /^([A-Z]+)\s+(.+)$/.exec(key.trim());
    const path = (m ? m[2] : key).trim();
    return { method: m ? m[1] : null, parts: path.split("/").filter(Boolean), handler };
  });
}

function match(routes: Route[], method: string, path: string) {
  const segs = path.split("/").filter(Boolean);
  // Exact-method routes win over any-method routes; static segments over params.
  let best: { route: Route; params: Record<string, string>; score: number } | null = null;
  for (const route of routes) {
    if (route.method && route.method !== method) continue;
    if (route.parts.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let score = route.method ? 1000 : 0;
    let ok = true;
    for (let i = 0; i < segs.length; i++) {
      const p = route.parts[i];
      if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(segs[i]);
      else if (p === segs[i]) score += 1;
      else { ok = false; break; }
    }
    if (ok && (!best || score > best.score)) best = { route, params, score };
  }
  return best;
}

let activeRoutes: Route[] | null = null;
let realFetch: typeof fetch | null = null;

function apiPath(input: RequestInfo | URL): URL | null {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let url: URL;
  try { url = new URL(raw, window.location.href); } catch { return null; }
  if (url.origin !== window.location.origin || !url.pathname.startsWith(API_PREFIX + "/")) return null;
  return url;
}

function json(status: number, body: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Route /api-proxy requests to `api` (replacing any previously installed table). */
export function installMockApi(api: TimelyMockApi) {
  if (typeof window === "undefined") return;
  activeRoutes = compile(api);
  if (realFetch) return;
  realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = activeRoutes ? apiPath(input) : null;
    if (!url || !activeRoutes) return realFetch!(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const path = url.pathname.slice(API_PREFIX.length) || "/";
    let body: unknown;
    if (typeof init?.body === "string") {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    const hit = match(activeRoutes, method, path);
    if (!hit) {
      // Unknown reads are missing data; unknown writes succeed so interactions
      // in a design don't surface error toasts.
      return method === "GET" ? json(404, { error: `no mock for GET ${path}` }) : json(200, {});
    }
    const { handler } = hit.route;
    const value = typeof handler === "function"
      ? await (handler as (r: MockRequest) => unknown)({ method, path, params: hit.params, query: url.searchParams, body })
      : handler;
    if (value === undefined) return json(404, { error: `not found: ${path}` });
    if (value instanceof Response) return value;
    if (value instanceof Blob) return new Response(value, { status: 200, headers: { "Content-Type": value.type } });
    return json(200, structuredClone(value));
  };
}
