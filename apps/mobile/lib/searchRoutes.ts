import type { Href } from "expo-router";
import type { SearchKind } from "./api/search";
import { fileHref } from "./fileRoutes";

/** Detail route for a search hit or related item. */
export function hrefFor(kind: SearchKind, id: string): Href {
  if (kind === "sheet" || kind === "doc") return fileHref(id);
  const encoded = encodeURIComponent(id);
  if (kind === "task") return `/(app)/tasks/${encoded}`;
  if (kind === "event") return `/(app)/events/${encoded}`;
  if (kind === "project") return `/(app)/projects/${encoded}`;
  return "/(app)/(tabs)/tasks";
}
