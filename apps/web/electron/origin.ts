// URL policy for the desktop shell's window guards. Kept free of Electron
// imports so scripts/electron-guards.test.mjs can exercise it directly.

/**
 * True only when `url` parses and its origin equals `origin` exactly. A prefix
 * comparison would accept `http://localhost:4002@attacker.example/` (userinfo)
 * or `https://trusted.example.attacker.example/` (lookalike host).
 */
export function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Whether a URL that is not ours may be handed to the operating system. */
export function isOpenableExternally(url: string): boolean {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

const RENDERER_PERMISSIONS = new Set(["clipboard-read", "clipboard-sanitized-write", "fullscreen"]);

/** Whether a web permission may be granted to `url`: only ours, only what the app uses. */
export function isPermissionAllowed(permission: string, url: string, origin: string): boolean {
  return RENDERER_PERMISSIONS.has(permission) && isSameOrigin(url, origin);
}
