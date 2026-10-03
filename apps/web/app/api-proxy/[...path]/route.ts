import type { NextRequest } from "next/server";

/**
 * Runtime API proxy for the packaged desktop app.
 *
 * `next.config.ts` rewrites `/api-proxy/*` to `API_ORIGIN` for `next dev`,
 * Docker and plain `next start`, but a rewrite is baked into the standalone
 * output at build time. The desktop app only learns its API port when the
 * supervisor allocates it (docs/desktop/README.md), so Electron builds leave
 * the rewrite out and this handler forwards each request using the
 * `API_ORIGIN` the supervisor passes to the Next sidecar. Streams (document
 * watch, agent runs) pass through untouched; cookies are forwarded both ways.
 */

export const dynamic = "force-dynamic";

const HOP_BY_HOP = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length"];

function apiOrigin(): string {
  return (process.env.API_ORIGIN || "http://127.0.0.1:8080").replace(/\/+$/, "");
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await context.params;
  const target = new URL(`${apiOrigin()}/${path.map(encodeURIComponent).join("/")}`);
  target.search = request.nextUrl.search;

  const headers = new Headers(request.headers);
  for (const name of HOP_BY_HOP) headers.delete(name);
  // The API sees the app's loopback origin, never the renderer's.
  headers.delete("origin");

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
    cache: "no-store",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return Response.json({ message: `The Timely server did not answer (${detail})` }, { status: 502 });
  }

  const out = new Headers();
  upstream.headers.forEach((value, name) => {
    if (name === "set-cookie" || name === "content-encoding" || name === "content-length" || name === "transfer-encoding") return;
    out.set(name, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) out.append("set-cookie", cookie);

  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE, proxy as HEAD, proxy as OPTIONS };
