/**
 * Where MCP clients (Hermes, Claude Desktop, ...) reach this server's `/mcp`.
 * Pure: no React, no window access, so scripts/mcp-url.test.mjs can run it.
 *
 * The desktop app runs its own API on a port chosen per build and machine
 * (48080 for Timely, 48090 for Timely Dev, or another one when that is taken),
 * so the address comes from the desktop bridge. Everywhere else the API sits
 * behind the web app's own origin (`/api-proxy`, or NEXT_PUBLIC_API_URL).
 */
import type { DesktopInstance } from "@/electron-env";

export type McpUrls = {
  /** The address to put in a client on this computer. */
  local: string;
  /** Tailscale addresses for clients on other devices (desktop app only). */
  remote: string[];
};

function withMcp(base: string): string {
  return `${base.replace(/\/+$/, "")}/mcp`;
}

export function mcpUrls(input: {
  desktop: Pick<DesktopInstance, "api"> | null;
  /** API_BASE from app/utils/api/client.ts: absolute, or a path on `origin`. */
  apiBase: string;
  /** window.location.origin */
  origin: string;
}): McpUrls {
  const { desktop, apiBase, origin } = input;
  if (desktop) {
    return { local: withMcp(desktop.api.localUrl), remote: desktop.api.tailscaleUrls.map(withMcp) };
  }
  if (/^https?:\/\//.test(apiBase)) return { local: withMcp(apiBase), remote: [] };
  const path = apiBase.startsWith("/") ? apiBase : `/${apiBase}`;
  return { local: withMcp(`${origin.replace(/\/+$/, "")}${path}`), remote: [] };
}
