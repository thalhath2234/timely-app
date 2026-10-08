import assert from "node:assert/strict";
import test from "node:test";
import { mcpUrls } from "../apps/web/app/utils/mcpUrl.ts";

// Settings → Integrations shows the MCP address. It used to be a hard-coded
// http://localhost:8080/mcp, which is wrong for both desktop builds.

const api = (port, tailscaleUrls = []) => ({
  api: { status: "running", restarts: 0, port, localUrl: `http://127.0.0.1:${port}`, tailscaleUrls, bind: [] },
});

test("the desktop release uses its own API port", () => {
  assert.deepEqual(mcpUrls({ desktop: api(48080), apiBase: "/api-proxy", origin: "http://127.0.0.1:44001" }), {
    local: "http://127.0.0.1:48080/mcp",
    remote: [],
  });
});

test("Timely Dev, or a moved port, follows the bridge", () => {
  assert.equal(mcpUrls({ desktop: api(48090), apiBase: "/api-proxy", origin: "http://127.0.0.1:44011" }).local, "http://127.0.0.1:48090/mcp");
  assert.equal(mcpUrls({ desktop: api(51234), apiBase: "/api-proxy", origin: "http://127.0.0.1:44001" }).local, "http://127.0.0.1:51234/mcp");
});

test("Tailscale addresses are offered for other devices", () => {
  const urls = mcpUrls({ desktop: api(48080, ["http://100.101.102.103:48080"]), apiBase: "/api-proxy", origin: "http://127.0.0.1:44001" });
  assert.deepEqual(urls.remote, ["http://100.101.102.103:48080/mcp"]);
});

test("the web app goes through its own origin", () => {
  assert.equal(mcpUrls({ desktop: null, apiBase: "/api-proxy", origin: "http://localhost:4001" }).local, "http://localhost:4001/api-proxy/mcp");
  assert.equal(mcpUrls({ desktop: null, apiBase: "/api-proxy", origin: "https://timely.example.com/" }).local, "https://timely.example.com/api-proxy/mcp");
});

test("an absolute NEXT_PUBLIC_API_URL is used as is", () => {
  assert.deepEqual(mcpUrls({ desktop: null, apiBase: "https://api.example.com/", origin: "https://timely.example.com" }), {
    local: "https://api.example.com/mcp",
    remote: [],
  });
});
