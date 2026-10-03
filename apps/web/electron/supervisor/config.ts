// userData/config.json: non-secret settings plus sealed secrets.
// Contract: docs/desktop/README.md ("Config"). Electron-free; main.ts injects
// safeStorage through a Sealer so this module stays unit-testable.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const DEFAULT_PORTS = { postgresPort: 54329, apiPort: 48080, webPort: 44001 } as const;

export type SecretKey = "jwtSecret" | "backupKey" | "dbPassword";
export const SECRET_KEYS: readonly SecretKey[] = ["jwtSecret", "backupKey", "dbPassword"];

export type DesktopConfig = {
  version: string;
  postgresPort: number;
  apiPort: number;
  webPort: number;
  tailscaleEnabled: boolean;
  allowRegistration: boolean;
  setupDone: boolean;
  /** Sealed values; see Sealer. */
  secrets: Partial<Record<SecretKey, string>>;
  /**
   * Sealed values that could not be unsealed (a lost OS keyring) and were
   * replaced. Kept so a restored keyring can still recover them: the backup
   * key decrypts older .tlbk exports.
   */
  lostSecrets?: { key: SecretKey; sealed: string; lostAt: string }[];
};

export type Secrets = Record<SecretKey, string>;

/**
 * Seals a secret for storage. main.ts wires Electron's safeStorage; when the
 * OS has no keyring the `plain:` form is used instead, and `unseal` always
 * accepts `plain:` so a file written without a keyring keeps working after
 * one appears.
 */
export type Sealer = {
  seal(plain: string): string;
  unseal(sealed: string): string;
};

export const PLAIN_PREFIX = "plain:";

export const plainSealer: Sealer = {
  seal: (plain) => `${PLAIN_PREFIX}${plain}`,
  unseal: (sealed) => unsealPlain(sealed),
};

function unsealPlain(sealed: string): string {
  if (!sealed.startsWith(PLAIN_PREFIX)) {
    throw new Error("Secret is encrypted but no decryption is available");
  }
  return sealed.slice(PLAIN_PREFIX.length);
}

/**
 * Builds a Sealer from optional encrypt/decrypt primitives (e.g. safeStorage).
 * `encrypt` produces bytes that are stored base64; `plain:` values pass
 * through either way.
 */
export function makeSealer(primitives: {
  available: boolean;
  encrypt?: (plain: string) => Buffer;
  decrypt?: (sealed: Buffer) => string;
}): Sealer {
  const { available, encrypt, decrypt } = primitives;
  if (!available || !encrypt || !decrypt) return plainSealer;
  return {
    seal: (plain) => encrypt(plain).toString("base64"),
    unseal: (sealed) => (sealed.startsWith(PLAIN_PREFIX) ? unsealPlain(sealed) : decrypt(Buffer.from(sealed, "base64"))),
  };
}

export function defaultConfig(version: string): DesktopConfig {
  return {
    version,
    ...DEFAULT_PORTS,
    tailscaleEnabled: false,
    allowRegistration: true,
    setupDone: false,
    secrets: {},
  };
}

function readLostSecrets(raw: unknown): DesktopConfig["lostSecrets"] {
  if (!Array.isArray(raw)) return undefined;
  const entries = raw.filter(
    (e): e is { key: SecretKey; sealed: string; lostAt: string } =>
      Boolean(e) && typeof e === "object" && SECRET_KEYS.includes((e as { key: SecretKey }).key) && typeof (e as { sealed: unknown }).sealed === "string" && typeof (e as { lostAt: unknown }).lostAt === "string",
  );
  return entries.length ? entries : undefined;
}

function isPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value < 65536;
}

/** Reads the config file, filling anything missing or malformed with defaults. */
export function loadConfig(file: string, fallbackVersion: string): { config: DesktopConfig; existed: boolean } {
  const defaults = defaultConfig(fallbackVersion);
  if (!existsSync(file)) return { config: defaults, existed: false };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { config: defaults, existed: false };
  }
  if (!raw || typeof raw !== "object") return { config: defaults, existed: false };
  const data = raw as Record<string, unknown>;
  const secretsRaw = data.secrets && typeof data.secrets === "object" ? (data.secrets as Record<string, unknown>) : {};
  const secrets: Partial<Record<SecretKey, string>> = {};
  for (const key of SECRET_KEYS) {
    if (typeof secretsRaw[key] === "string" && secretsRaw[key]) secrets[key] = secretsRaw[key] as string;
  }
  return {
    existed: true,
    config: {
      version: typeof data.version === "string" && data.version ? data.version : "",
      postgresPort: isPort(data.postgresPort) ? data.postgresPort : defaults.postgresPort,
      apiPort: isPort(data.apiPort) ? data.apiPort : defaults.apiPort,
      webPort: isPort(data.webPort) ? data.webPort : defaults.webPort,
      tailscaleEnabled: data.tailscaleEnabled === true,
      allowRegistration: data.allowRegistration !== false,
      setupDone: data.setupDone === true,
      secrets,
      lostSecrets: readLostSecrets(data.lostSecrets),
    },
  };
}

/** Writes atomically (tmp + rename) with mode 0600. */
export function saveConfig(file: string, config: DesktopConfig): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}

export function generateSecret(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Guarantees every secret exists and can be unsealed. Missing or unreadable
 * secrets are regenerated (a lost keyring means a lost secret; the API
 * re-issues sessions and the database password is re-applied on the next
 * boot by the caller, which gets `regenerated` to decide what to do). An
 * unreadable sealed value is moved to `lostSecrets`, never deleted.
 */
export function ensureSecrets(
  config: DesktopConfig,
  sealer: Sealer,
  generate: () => string = generateSecret,
): { secrets: Secrets; changed: boolean; regenerated: SecretKey[] } {
  const secrets = {} as Secrets;
  const regenerated: SecretKey[] = [];
  for (const key of SECRET_KEYS) {
    const sealed = config.secrets[key];
    if (sealed) {
      try {
        secrets[key] = sealer.unseal(sealed);
        continue;
      } catch {
        config.lostSecrets = [...(config.lostSecrets ?? []), { key, sealed, lostAt: new Date().toISOString() }];
      }
    }
    const fresh = generate();
    secrets[key] = fresh;
    config.secrets[key] = sealer.seal(fresh);
    regenerated.push(key);
  }
  return { secrets, changed: regenerated.length > 0, regenerated };
}
