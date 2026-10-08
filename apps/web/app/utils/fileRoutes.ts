/**
 * Docs and sheets share one section, Files, and one route family:
 * /files is the start page and /files/<id> opens a doc, sheet or sheet
 * template. Server IDs carry their kind as a prefix (doc_, sht_, shtpl_),
 * so the page picks its view from the ID alone.
 */
export const FILES_PATH = "/files";

export type FileKind = "doc" | "sheet" | "template";

export function fileHref(id: string) {
  return `${FILES_PATH}/${id}`;
}

export function fileKind(id: string): FileKind {
  if (id.startsWith("shtpl_")) return "template";
  if (id.startsWith("sht_")) return "sheet";
  return "doc";
}

/** The id in a /files/<id> pathname, or null for any other path. */
export function fileIdFromPath(pathname: string) {
  return /^\/files\/([^/]+)$/.exec(pathname)?.[1] ?? null;
}

/**
 * Where an old /docs or /sheets path lives now, or null when `pathname` isn't
 * one. Links saved before the merge (bookmarks, tabs, pasted links) still
 * point there.
 */
export function legacyFilePath(pathname: string) {
  if (!/^\/(docs|sheets)(\/|$)/.test(pathname)) return null;
  const match = /^\/(?:docs|sheets(?:\/templates)?)\/([^/]+)\/?$/.exec(pathname);
  return match && match[1] !== "templates" ? fileHref(match[1]) : FILES_PATH;
}
