/**
 * Docs, sheets and sheet templates share one route family, `/files/<id>`.
 * The server prefixes every ID (`doc_`, `sht_`, `shtpl_`), so the detail
 * screen picks the editor from the ID itself.
 */

export type FileKind = "doc" | "sheet" | "template";

/** The Files tab. */
export const FILES_TAB = "/(app)/(tabs)/files";

/** Which editor an ID opens; unknown prefixes fall back to the doc screen. */
export function fileKind(id: string): FileKind {
  if (id.startsWith("shtpl_")) return "template";
  if (id.startsWith("sht_")) return "sheet";
  return "doc";
}

/** Detail route for a doc, sheet or sheet template ID. */
export function fileHref(id: string) {
  return `/(app)/files/${encodeURIComponent(id)}` as const;
}

/**
 * Maps a legacy `/docs`, `/sheets`, `/sheets/templates/<id>`, `/docs/<id>` or
 * `/sheets/<id>` path (with or without the `/(app)` group prefix) to its Files
 * route. Returns null for any other path.
 */
export function legacyFilePath(path: string): string | null {
  const match = path.match(/^(?:\/\(app\))?(?:\/\(tabs\))?\/(docs|sheets)(?:\/templates)?(?:\/([^/?#]+))?\/?(?:[?#].*)?$/);
  if (!match) return null;
  const id = match[2];
  if (id) {
    let decoded = id;
    try {
      decoded = decodeURIComponent(id);
    } catch {
      // Keep the raw segment; fileHref encodes it again.
    }
    return fileHref(decoded);
  }
  // `/sheets/templates` without an ID is not a screen of its own.
  return FILES_TAB;
}
