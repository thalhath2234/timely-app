import type { NextRequest } from "next/server";

/**
 * Runtime API proxy for every build: `next dev`, `next start`, Docker and the
 * packaged desktop app.
 *
 * Each request is forwarded to `API_ORIGIN` as it is set when the server runs:
 * the root `.env` (loaded by `next.config.ts`), the container's environment,
 * or the port the desktop supervisor allocates and passes to the Next sidecar
 * (docs/desktop/README.md). A `next.config.ts` rewrite would be baked in at
 * `next build` instead, so one image could only ever reach one address.
 * Streams (document watch, agent runs) pass through untouched; cookies are
 * forwarded both ways.
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
  // The API sees the app's loopback origin, never the renderer's. It marks
  // session cookies Secure for an https page, so keep that one fact for a
  // TLS proxy in front that does not set X-Forwarded-Proto itself.
  if (request.headers.get("origin")?.startsWith("https://")) headers.set("x-forwarded-proto", "https");
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
