import type {
  McpAddInput,
  McpCatalogRow,
  McpServer,
  McpServersResponse,
  McpTool,
  McpUpdateInput,
} from "@timely/contract/agentMcp";
import { api, getApiUrl } from "./client";
import { isOffline } from "../networkState";

/**
 * External MCP servers on the phone (phase 5, Q-5.6): the list, the mode of
 * each, sign-in, the tools, removing, and adding a catalog server that asks
 * for nothing. A command server and an address are added in the desktop
 * window. Same routes as the web: /agent/mcp/*.
 */

function write<T>(path: string, method: string, body?: unknown): Promise<T> {
  if (isOffline()) return Promise.reject(new Error("Reconnect to change your MCP servers."));
  return api<T>(`/agent/mcp${path}`, { method, body, queueIfOffline: false });
}

const name = (server: string) => encodeURIComponent(server);

export const getMcpServers = () => api<McpServersResponse>("/agent/mcp/servers");

export async function getMcpCatalog(): Promise<McpCatalogRow[]> {
  return (await api<{ servers: McpCatalogRow[] }>("/agent/mcp/catalog")).servers;
}

export async function addMcpServer(input: McpAddInput): Promise<{ server: McpServer; pending: boolean }> {
  const out = await write<{ server: McpServer; message?: string }>("/servers", "POST", input);
  return { server: out.server, pending: out.server.status === "waiting_for_ok" };
}

export async function updateMcpServer(server: string, patch: McpUpdateInput): Promise<McpServer> {
  return (await write<{ server: McpServer }>(`/servers/${name(server)}`, "PUT", patch)).server;
}

export const removeMcpServer = (server: string) => write<void>(`/servers/${name(server)}`, "DELETE");

export const getMcpTools = (server: string) =>
  api<{ tools: McpTool[]; error?: string; needsSignIn?: boolean }>(`/agent/mcp/servers/${name(server)}/tools`);

/**
 * Begins a sign-in and returns the server's page to open in the browser. The server sends
 * the browser back to Timely at the address this phone uses for it, so the phone's browser
 * has to reach that address (the same network, or Tailscale).
 */
export async function startMcpSignIn(server: string): Promise<string> {
  const redirectBase = await getApiUrl();
  return (await write<{ authorizeUrl: string }>(`/servers/${name(server)}/sign-in`, "POST", { redirectBase })).authorizeUrl;
}
