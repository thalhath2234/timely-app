/**
 * Server list model for the phone. Pure and React Native-free so it can run
 * under `node --test`; `lib/server/index.ts` wires SecureStore and
 * `lib/server/ServerProvider.tsx` drives it at runtime.
 *
 * The desktop app shows a QR code (docs/desktop/README.md, "Pairing payload"):
 *   { "v": 1, "name": "my-laptop", "urls": ["http://100.x.y.z:48080", "http://127.0.0.1:48080"] }
 * The phone also accepts a bare http(s) URL pasted by hand.
 */

export type ServerConfig = {
  /** Every address the server can be reached at, in the order the desktop listed them. */
  urls: string[];
  /** The address that answered most recently; tried first on the next launch. */
  active?: string;
  /** Hostname of the desktop that produced the pairing payload. */
  name?: string;
};

export type PairingInput = { urls: string[]; name?: string };

/** `GET /health` on the API. 200 answers "ok"; 503 answers "degraded" with the DB error in `db`. */
export type ServerHealth = {
  status: string;
  version?: string;
  db?: string;
  migrations?: { version: number; pending: number };
  registrationOpen?: boolean;
  uptimeSeconds?: number;
};

export const SERVER_CONFIG_KEY = "timely.server.config";
export const DEFAULT_PROBE_TIMEOUT_MS = 2500;

/** Trim, drop trailing slashes, and reject anything that is not an absolute http(s) URL. */
export function normalizeServerUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/?#]+(?:[/?#]\S*)?$/i.test(trimmed)) return null;
  return trimmed;
}

function normalizeUrls(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const value of values) {
    const url = normalizeServerUrl(value);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function cleanName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return name ? name : undefined;
}

/**
 * True for a plain-http address the phone would reach over an ordinary
 * network, where anyone on the same Wi-Fi can read the password and tokens.
 * Loopback, the emulator's host alias and Tailscale (100.64.0.0/10,
 * fd7a:115c:a1e0::/48, *.ts.net) are encrypted or local, so they pass.
 */
export function isInsecureServerUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:") return false;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "10.0.2.2" || host === "::1" || host.endsWith(".ts.net")) return false;
  const v4 = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  if (host.startsWith("fd7a:115c:a1e0:")) return false;
  return true;
}

/**
 * Accepts the QR payload or a bare URL. Returns null when the text is neither.
 * Invalid entries inside a payload are skipped; a payload with no usable URL is rejected.
 */
export function parsePairingInput(text: string): PairingInput | null {
  if (typeof text !== "string") return null;
  const raw = text.trim();
  if (!raw) return null;

  if (raw.startsWith("{")) {
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!payload || typeof payload !== "object") return null;
    const { urls, name } = payload as { urls?: unknown; name?: unknown };
    const normalized = normalizeUrls(urls);
    if (normalized.length === 0) return null;
    const cleaned = cleanName(name);
    return cleaned ? { urls: normalized, name: cleaned } : { urls: normalized };
  }

  const url = normalizeServerUrl(raw);
  return url ? { urls: [url] } : null;
}

/** Validates a stored or incoming config. `active` is kept only when it is one of `urls`. */
export function normalizeServerConfig(value: unknown): ServerConfig | null {
  if (!value || typeof value !== "object") return null;
  const { urls, active, name } = value as { urls?: unknown; active?: unknown; name?: unknown };
  const normalizedUrls = normalizeUrls(urls);
  if (normalizedUrls.length === 0) return null;
  const config: ServerConfig = { urls: normalizedUrls };
  const normalizedActive = normalizeServerUrl(active);
  if (normalizedActive && normalizedUrls.includes(normalizedActive)) config.active = normalizedActive;
  const cleaned = cleanName(name);
  if (cleaned) config.name = cleaned;
  return config;
}

/** The remembered address first, then the others in their listed order. */
export function orderCandidates(config: Pick<ServerConfig, "urls" | "active">): string[] {
  const rest = config.urls.filter((url) => url !== config.active);
  return config.active ? [config.active, ...rest] : rest;
}

export type Probe<T> = (url: string, signal: AbortSignal) => Promise<T>;

export type ReachableResult<T> = { url: string; result: T };

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

function probeWithTimeout<T>(
  url: string,
  probe: Probe<T>,
  timeoutMs: number,
  controller: AbortController,
): Promise<Outcome<T>> {
  return new Promise<Outcome<T>>((resolve) => {
    let settled = false;
    const finish = (outcome: Outcome<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      controller.abort();
      finish({ ok: false, error: new Error(`${url} did not answer within ${timeoutMs} ms`) });
    }, timeoutMs);
    let attempt: Promise<T>;
    try {
      attempt = probe(url, controller.signal);
    } catch (error) {
      finish({ ok: false, error });
      return;
    }
    attempt.then(
      (value) => finish({ ok: true, value }),
      (error) => finish({ ok: false, error }),
    );
  });
}

/**
 * Probes every URL at once, each with its own timeout, but hands back the
 * first one *in preference order* that answers: a fast second address never
 * beats a slower first address that still answers in time. Resolves null when
 * none answers.
 */
export async function pickReachable<T>(
  urls: string[],
  probe: Probe<T>,
  options: { timeoutMs?: number } = {},
): Promise<ReachableResult<T> | null> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const controllers = urls.map(() => new AbortController());
  const attempts = urls.map((url, index) => probeWithTimeout(url, probe, timeoutMs, controllers[index]));

  for (let index = 0; index < urls.length; index += 1) {
    const outcome = await attempts[index];
    if (!outcome.ok) continue;
    for (let rest = index + 1; rest < controllers.length; rest += 1) controllers[rest].abort();
    return { url: urls[index], result: outcome.value };
  }
  return null;
}

/** Shape check for the `/health` payload; anything else is not a Timely server. */
export function parseHealthPayload(value: unknown): ServerHealth | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (typeof body.status !== "string") return null;
  const health: ServerHealth = { status: body.status };
  if (typeof body.version === "string") health.version = body.version;
  if (typeof body.db === "string") health.db = body.db;
  if (typeof body.registrationOpen === "boolean") health.registrationOpen = body.registrationOpen;
  if (typeof body.uptimeSeconds === "number") health.uptimeSeconds = body.uptimeSeconds;
  const migrations = body.migrations as { version?: unknown; pending?: unknown } | undefined;
  if (migrations && typeof migrations === "object" && typeof migrations.version === "number" && typeof migrations.pending === "number") {
    health.migrations = { version: migrations.version, pending: migrations.pending };
  }
  return health;
}

export type ServerStorage = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

export type ServerStore = {
  load(): Promise<ServerConfig | null>;
  save(config: ServerConfig): Promise<ServerConfig>;
  clear(): Promise<void>;
};

export function createServerStore(storage: ServerStorage): ServerStore {
  return {
    async load() {
      try {
        const raw = await storage.get(SERVER_CONFIG_KEY);
        if (!raw) return null;
        return normalizeServerConfig(JSON.parse(raw));
      } catch {
        return null;
      }
    },
    async save(config) {
      const normalized = normalizeServerConfig(config);
      if (!normalized) throw new Error("A server needs at least one http(s) address");
      await storage.set(SERVER_CONFIG_KEY, JSON.stringify(normalized));
      return normalized;
    },
    async clear() {
      try {
        await storage.delete(SERVER_CONFIG_KEY);
      } catch {
        // Nothing to forget.
      }
    },
  };
}
