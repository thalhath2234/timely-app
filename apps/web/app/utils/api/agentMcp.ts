import type {
  McpAddInput,
  McpCatalogRow,
  McpServer,
  McpServersResponse,
  McpTool,
  McpUpdateInput,
} from "@timely/contract/agentMcp";
import { API_BASE, apiFetch } from "./client";

/**
 * External MCP servers: /agent/mcp/* (phase 5, Q-5.6). Servers, modes and
 * tokens are Timely's own; the catalog and the tool lists come from the
 * account's agent worker, so they can take a few seconds the first time.
 */

/** A thrown answer keeps its status, so a screen can tell "the assistant isn't running" from a refusal. */
export class McpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await apiFetch(`/agent/mcp${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const error = (await res.json().catch(() => ({}))) as { message?: string };
    throw new McpError(error.message || "Couldn't reach your MCP servers. Try again.", res.status);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const name = (server: string) => encodeURIComponent(server);

export const getMcpServers = () => request<McpServersResponse>("/servers");

export async function getMcpCatalog(): Promise<McpCatalogRow[]> {
  return (await request<{ servers: McpCatalogRow[] }>("/catalog")).servers;
}

/** `pending` is true when the server waits for the person's OK on a host card (a 202). */
export async function addMcpServer(input: McpAddInput): Promise<{ server: McpServer; pending: boolean }> {
  const res = await apiFetch("/agent/mcp/servers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await res.json().catch(() => ({}))) as { server?: McpServer; message?: string };
  if (!res.ok || !data.server) throw new McpError(data.message || "Couldn't add the server.", res.status);
  return { server: data.server, pending: res.status === 202 };
}

export async function updateMcpServer(server: string, patch: McpUpdateInput): Promise<{ server: McpServer; pending: boolean }> {
  const res = await apiFetch(`/agent/mcp/servers/${name(server)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = (await res.json().catch(() => ({}))) as { server?: McpServer; message?: string };
  if (!res.ok || !data.server) throw new McpError(data.message || "Couldn't save the change.", res.status);
  return { server: data.server, pending: res.status === 202 };
}

export const removeMcpServer = (server: string) => request<void>(`/servers/${name(server)}`, "DELETE");

/** The server's tools, asked of the account's worker. A server that did not answer gives `error`. */
export const getMcpTools = (server: string) =>
  request<{ tools: McpTool[]; error?: string; needsSignIn?: boolean }>(`/servers/${name(server)}/tools`);

/**
 * Begins a sign-in and returns the page to open. The server sends the browser back to Timely's own
 * origin as this page reaches the API (`redirectBase`), so the callback lands on the API.
 */
export async function startMcpSignIn(server: string): Promise<string> {
  const base = /^https?:\/\//.test(API_BASE) ? API_BASE : `${window.location.origin}${API_BASE}`;
  const out = await request<{ authorizeUrl: string }>(`/servers/${name(server)}/sign-in`, "POST", { redirectBase: base });
  return out.authorizeUrl;
}
