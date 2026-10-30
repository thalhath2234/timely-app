// Tailscale detection: interface scan plus the CLI when it is installed.
// Electron-free; the CIDR checks are pure so they can be unit-tested.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type TailscaleInfo = {
  installed: boolean;
  running: boolean;
  ipv4?: string;
  ipv6?: string;
  hostname?: string;
  /** MagicDNS name (host.tailnet.ts.net, no trailing dot); needed for HTTPS. */
  dnsName?: string;
};

/** 100.64.0.0/10 — the CGNAT range Tailscale hands out. */
export function isTailscaleIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (octets.some((o) => Number.isNaN(o) || o > 255)) return false;
  return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}

/** fd7a:115c:a1e0::/48 — Tailscale's ULA prefix. */
export function isTailscaleIPv6(ip: string): boolean {
  const bare = ip.split("%")[0].toLowerCase();
  const groups = expandIPv6(bare);
  if (!groups) return false;
  return groups[0] === 0xfd7a && groups[1] === 0x115c && groups[2] === 0xa1e0;
}

/** Expands an IPv6 string to eight 16-bit groups, or null when malformed. */
export function expandIPv6(ip: string): number[] | null {
  if (!ip || /[^0-9a-f:.]/i.test(ip)) return null;
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":"));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  // Embedded IPv4 tail (::ffff:1.2.3.4) is not a Tailscale form; reject.
  if ([...head, ...tail].some((g) => g.includes("."))) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (halves.length === 2 && missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const numbers = groups.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  return numbers.some(Number.isNaN) ? null : numbers;
}

export type InterfaceMap = Record<string, { family: string | number; address: string; internal: boolean }[] | undefined>;

/** Picks the first Tailscale IPv4/IPv6 from an os.networkInterfaces() map. */
export function scanInterfaces(interfaces: InterfaceMap): { ipv4?: string; ipv6?: string } {
  let ipv4: string | undefined;
  let ipv6: string | undefined;
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      const family = String(entry.family);
      if (!ipv4 && (family === "IPv4" || family === "4") && isTailscaleIPv4(entry.address)) ipv4 = entry.address;
      if (!ipv6 && (family === "IPv6" || family === "6") && isTailscaleIPv6(entry.address)) ipv6 = entry.address.split("%")[0];
    }
  }
  return { ipv4, ipv6 };
}

const CLI_CANDIDATES: Record<string, string[]> = {
  linux: ["/usr/bin/tailscale", "/usr/local/bin/tailscale"],
  darwin: ["/usr/local/bin/tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"],
  win32: ["C:\\Program Files\\Tailscale\\tailscale.exe"],
};

export function findTailscaleCli(platform = process.platform, env = process.env): string | null {
  for (const candidate of CLI_CANDIDATES[platform] ?? []) {
    if (existsSync(candidate)) return candidate;
  }
  const exe = platform === "win32" ? "tailscale.exe" : "tailscale";
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, exe);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

type StatusJson = {
  BackendState?: string;
  Self?: { DNSName?: string; HostName?: string; TailscaleIPs?: string[] };
};

function runStatus(cli: string, timeoutMs: number): Promise<StatusJson | null> {
  return new Promise((resolve) => {
    execFile(cli, ["status", "--json"], { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(stdout) as StatusJson);
      } catch {
        resolve(null);
      }
    });
  });
}

/** Merges CLI status (preferred) with the interface scan (fallback). */
export function mergeStatus(cliFound: boolean, status: StatusJson | null, scan: { ipv4?: string; ipv6?: string }): TailscaleInfo {
  const info: TailscaleInfo = { installed: cliFound || Boolean(scan.ipv4 || scan.ipv6), running: false, ...scan };
  if (status?.Self) {
    for (const ip of status.Self.TailscaleIPs ?? []) {
      if (!info.ipv4 && isTailscaleIPv4(ip)) info.ipv4 = ip;
      if (!info.ipv6 && isTailscaleIPv6(ip)) info.ipv6 = ip;
    }
    const dnsName = status.Self.DNSName?.replace(/\.$/, "");
    const hostname = status.Self.HostName || dnsName;
    if (hostname) info.hostname = hostname;
    if (dnsName) info.dnsName = dnsName;
  }
  info.running = Boolean(info.ipv4 || info.ipv6);
  return info;
}

export async function detectTailscale(options: { timeoutMs?: number; platform?: NodeJS.Platform } = {}): Promise<TailscaleInfo> {
  const cli = findTailscaleCli(options.platform);
  const status = cli ? await runStatus(cli, options.timeoutMs ?? 3000) : null;
  return mergeStatus(cli !== null, status, scanInterfaces(os.networkInterfaces() as InterfaceMap));
}

/** http://host:port with IPv6 literals bracketed. */
export function urlFor(host: string, port: number): string {
  return host.includes(":") ? `http://[${host}]:${port}` : `http://${host}:${port}`;
}

// ---- Tailscale Serve: HTTPS on https://<dnsName>/ proxied to the loopback API.

export const SERVE_HTTPS_PORT = 443;
const SERVE_TIMEOUT_MS = 20_000;

type ServeConfig = {
  TCP?: Record<string, { HTTPS?: boolean; TCPForward?: string } | undefined>;
  Web?: Record<string, { Handlers?: Record<string, { Proxy?: string; Path?: string; Text?: string } | undefined> } | undefined>;
};

/**
 * Who serves https://<dnsName>:443 right now, from `tailscale serve status
 * --json`. "ours" when it proxies to `target` and nothing else, "other" when
 * anything else is configured on that port.
 */
export function serveOwner(json: unknown, dnsName: string, target: string): { owner: "none" | "ours" | "other"; detail?: string } {
  const config = (json && typeof json === "object" ? json : {}) as ServeConfig;
  const port = String(SERVE_HTTPS_PORT);
  const tcp = config.TCP?.[port];
  const web = config.Web?.[`${dnsName}:${port}`];
  const handlers = Object.entries(web?.Handlers ?? {});
  if (!tcp && handlers.length === 0) return { owner: "none" };
  if (tcp?.TCPForward) return { owner: "other", detail: `TCP forward to ${tcp.TCPForward}` };
  if (handlers.length === 1) {
    const [mount, handler] = handlers[0];
    if (mount === "/" && sameTarget(handler?.Proxy, target)) return { owner: "ours" };
  }
  const detail = handlers.map(([mount, handler]) => `${mount} → ${handler?.Proxy ?? handler?.Path ?? "text"}`).join(", ");
  return { owner: "other", detail: detail || "another service" };
}

function sameTarget(proxy: string | undefined, target: string): boolean {
  if (!proxy) return false;
  const strip = (url: string) => url.replace(/\/+$/, "").replace("://localhost:", "://127.0.0.1:");
  return strip(proxy) === strip(target);
}

/** The "visit this link to turn it on" URL tailscale prints when HTTPS or Serve is off for the tailnet. */
export function serveConsentUrl(output: string): string | undefined {
  return output.match(/https:\/\/login\.tailscale\.com\/\S+/)?.[0];
}

export type ServeRunner = (args: string[]) => Promise<{ ok: boolean; output: string }>;

export function serveRunner(cli: string, timeoutMs = SERVE_TIMEOUT_MS): ServeRunner {
  return (args) =>
    new Promise((resolve) => {
      execFile(cli, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        resolve({ ok: !error, output: `${stdout ?? ""}${stderr ?? ""}`.trim() });
      });
    });
}

/** Explains a failed `tailscale serve` run in words a person can act on. */
export function describeServeFailure(output: string): string {
  const consent = serveConsentUrl(output);
  if (consent) return `Turn on HTTPS for your tailnet first: open ${consent}, then try again.`;
  if (/access denied|permission denied|operator/i.test(output)) {
    return "Tailscale refused to change its settings for this user. Run `sudo tailscale set --operator=$USER` once, then try again.";
  }
  return output ? `tailscale serve failed: ${output.split("\n")[0]}` : "tailscale serve did not finish in time.";
}

/**
 * Points https://<dnsName>/ at `target` unless something else already uses
 * port 443 there. `previous` is the target Timely set up earlier (the API
 * port can move), which it may replace.
 */
export async function enableServe(run: ServeRunner, dnsName: string, target: string, previous?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const status = await run(["serve", "status", "--json"]);
  let json: unknown = {};
  if (status.ok && status.output) {
    try {
      json = JSON.parse(status.output);
    } catch {
      json = {};
    }
  }
  const current = serveOwner(json, dnsName, target);
  if (current.owner === "ours") return { ok: true };
  if (current.owner === "other" && !(previous && serveOwner(json, dnsName, previous).owner === "ours")) {
    return { ok: false, error: `https://${dnsName} is already used by Tailscale Serve (${current.detail}). Turn that off or move it to another port first.` };
  }
  const result = await run(["serve", "--bg", `--https=${SERVE_HTTPS_PORT}`, target]);
  return result.ok ? { ok: true } : { ok: false, error: describeServeFailure(result.output) };
}

/** Removes the HTTPS route, but only when it is still the one Timely set up. */
export async function disableServe(run: ServeRunner, dnsName: string, target: string): Promise<void> {
  const status = await run(["serve", "status", "--json"]);
  if (!status.ok) return;
  let json: unknown;
  try {
    json = JSON.parse(status.output || "{}");
  } catch {
    return;
  }
  if (serveOwner(json, dnsName, target).owner !== "ours") return;
  await run(["serve", `--https=${SERVE_HTTPS_PORT}`, "off"]);
}
