/**
 * Turns a raw user-agent (or API client name) into something a person can
 * recognise in the Devices list, e.g. "Chrome on Linux" or "Timely mobile".
 * The raw string stays available for an expandable technical detail.
 */
export function humanizeDeviceLabel(raw: string | null | undefined): string {
  const ua = (raw ?? "").trim();
  if (!ua) return "Unknown device";

  // Non-browser clients identify themselves plainly.
  const lower = ua.toLowerCase();
  if (lower.includes("timely-mobile") || lower.includes("expo") || lower.includes("okhttp")) {
    return "Timely mobile app";
  }
  if (lower.startsWith("curl/")) return "curl (command line)";
  if (lower.includes("postman")) return "Postman";
  if (lower.includes("insomnia")) return "Insomnia";
  if (lower.startsWith("python-requests") || lower.startsWith("python-urllib") || lower.startsWith("python/")) {
    return "Python script";
  }
  if (lower.startsWith("go-http-client") || lower.startsWith("go/")) return "Go client";
  if (lower.startsWith("node") || lower.includes("undici") || lower.includes("axios")) {
    return "Node.js client";
  }
  if (lower.includes("mcp")) return "MCP client";

  const browser = detectBrowser(ua);
  const os = detectOS(ua);
  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return `Browser on ${os}`;

  // Fall back to the first token so we never show a 200-character string.
  const token = ua.split(/[\s/(]/)[0];
  return token ? token : "Unknown device";
}

function detectBrowser(ua: string): string | null {
  // Order matters: many browsers include "Chrome" and "Safari" in their UA.
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/Vivaldi/.test(ua)) return "Vivaldi";
  if (/Brave/.test(ua)) return "Brave";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chromium\//.test(ua)) return "Chromium";
  if (/Chrome\//.test(ua) || /CriOS/.test(ua)) return "Chrome";
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return "Safari";
  if (/HeadlessChrome/.test(ua)) return "Headless Chrome";
  return null;
}

function detectOS(ua: string): string | null {
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Windows NT/.test(ua)) return "Windows";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Linux/.test(ua)) return "Linux";
  return null;
}

/** "just now", "5 minutes ago", "yesterday", or a short date for older stamps. */
export function formatLastUsed(value: string | null | undefined, now = new Date()): string {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
