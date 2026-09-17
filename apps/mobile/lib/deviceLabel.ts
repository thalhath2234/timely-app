export function humanizeDeviceLabel(raw: string | null | undefined): string {
  const ua = (raw ?? "").trim();
  if (!ua) return "Unknown device";

  const lower = ua.toLowerCase();
  if (lower.includes("timely-mobile") || lower.includes("expo") || lower.includes("okhttp")) {
    return "Timely mobile app";
  }
  if (lower.startsWith("curl/")) return "curl (command line)";
  if (lower.includes("postman")) return "Postman";
  if (lower.includes("insomnia")) return "Insomnia";
  if (lower.includes("mcp")) return "MCP client";

  const browser = detectBrowser(ua);
  const os = detectOS(ua);
  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return `Browser on ${os}`;

  const token = ua.split(/[\s/(]/)[0];
  return token ? token : "Unknown device";
}

function detectBrowser(ua: string): string | null {
  if (/Edg\//.test(ua)) return "Edge";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua) || /CriOS/.test(ua)) return "Chrome";
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return "Safari";
  return null;
}

function detectOS(ua: string): string | null {
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Windows NT/.test(ua)) return "Windows";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return null;
}

export function formatLastUsed(value: string | null | undefined, now = new Date()): string {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const minutes = Math.round((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 14) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
