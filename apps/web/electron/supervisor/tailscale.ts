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
    const hostname = status.Self.HostName || status.Self.DNSName?.replace(/\.$/, "");
    if (hostname) info.hostname = hostname;
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
