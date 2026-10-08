import { EMBED_PATTERNS, isEmbedUrl } from "./markdown";

/**
 * Embeds: pages from a few providers can be shown inside a doc. Markdown
 * writes an embed as an image of the page (`![](https://youtu.be/...)`, as
 * Obsidian does), so only links matching EMBED_PATTERNS (markdown.ts) read
 * back as embeds; any other image stays an image.
 */

export { isEmbedUrl };

export interface EmbedInfo {
  provider: string;
  /** The iframe's src. */
  src: string;
  /** Width / height for video players, or a fixed height in px. */
  aspect?: number;
  height?: number;
}

function seconds(value: string | null) {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const parts = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  return parts ? Number(parts[1] ?? 0) * 3600 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0) : 0;
}

function player(provider: string, m: RegExpExecArray, url: URL): Omit<EmbedInfo, "provider"> {
  switch (provider) {
    case "YouTube": {
      const start = seconds(url.searchParams.get("t") ?? url.searchParams.get("start"));
      return { src: `https://www.youtube-nocookie.com/embed/${m[1]}${start ? `?start=${start}` : ""}`, aspect: 16 / 9 };
    }
    case "Vimeo":
      return { src: `https://player.vimeo.com/video/${m[1]}`, aspect: 16 / 9 };
    case "Loom":
      return { src: `https://www.loom.com/embed/${m[1]}`, aspect: 16 / 9 };
    case "Spotify": {
      const kind = m[1].toLowerCase();
      return { src: `https://open.spotify.com/embed/${kind}/${m[2]}`, height: kind === "track" || kind === "episode" ? 152 : 352 };
    }
    case "Figma":
      return { src: `https://www.figma.com/embed?embed_host=timely&url=${encodeURIComponent(url.href)}`, aspect: 16 / 10 };
    default:
      return { src: `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result`, height: 420 };
  }
}

/** The player for an embeddable link, or null. */
export function embedInfo(link: string): EmbedInfo | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  for (const { provider, pattern } of EMBED_PATTERNS) {
    const match = pattern.exec(link);
    if (match) return { provider, ...player(provider, match, url) };
  }
  return null;
}

export const EMBED_PROVIDERS = ["YouTube", "Vimeo", "Loom", "Spotify", "Figma", "CodePen"];

/** GET /docs/link-preview: what a bookmark shows. Fields are "" when the page
 * could not be read. */
export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  siteName: string;
}

/** The host a bookmark shows under its title, without "www.". */
export function linkHost(link: string) {
  try {
    return new URL(link).host.replace(/^www\./, "");
  } catch {
    return link;
  }
}
