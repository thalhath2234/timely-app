/*
 * Doc properties: the "---" frontmatter block at the top of a Markdown file.
 * Shared by the web and mobile editors; the API reads them the same way in
 * apps/api/internal/richtext/properties.go for search.
 */

export interface Property {
  key: string;
  values: string[];
}

// Keys whose comma-separated values are a list, as Obsidian reads them.
const LIST_KEYS = new Set(["tags", "tag", "aliases", "alias", "categories", "category", "keywords", "cssclasses"]);

const unquote = (value: string) => value.trim().replace(/^(["'])(.*)\1$/, "$2").trim();

/**
 * The properties in frontmatter text, as key and values. Reads the YAML
 * people write by hand: "key: value", "key: [a, b]", "tags: a, b" and
 * "key:" followed by "- item" lines. Anything else is skipped.
 */
export function frontmatterEntries(text: string): Property[] {
  const entries: Property[] = [];
  for (const line of text.split("\n")) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && entries.length) {
      const value = unquote(item[1]);
      if (value) entries[entries.length - 1].values.push(value);
      continue;
    }
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    const raw = match[2].replace(/\s+#.*$/, "").trim();
    let values: string[];
    if (raw.startsWith("[") && raw.endsWith("]")) {
      values = raw.slice(1, -1).split(",").map(unquote);
    } else if (LIST_KEYS.has(key.toLowerCase())) {
      values = raw.split(",").map(unquote);
    } else {
      values = [unquote(raw)];
    }
    entries.push({ key, values: values.filter(Boolean) });
  }
  return entries;
}

export interface PropertyFilter {
  key: string;
  value: string;
}

const FILTER_RE = /(^|\s)([A-Za-z][A-Za-z0-9_-]*):(?:"([^"]+)"|([^\s"/]\S*))/g;

/**
 * Splits "trip status:draft owner:\"Sam Lee\"" into the words left ("trip")
 * and property filters. Same syntax as the API's search.
 */
export function splitPropertyQuery(query: string): { text: string; filters: PropertyFilter[] } {
  const filters: PropertyFilter[] = [];
  const text = query.replace(FILTER_RE, (_all, lead: string, key: string, quoted?: string, bare?: string) => {
    filters.push({ key, value: quoted ?? bare ?? "" });
    return lead;
  });
  return { text: text.split(/\s+/).filter(Boolean).join(" "), filters };
}

/** True when every filter's key has a value containing the filter's text. */
export function matchesPropertyFilters(properties: Property[], filters: PropertyFilter[]) {
  return filters.every(({ key, value }) =>
    properties.some(
      (prop) =>
        prop.key.toLowerCase() === key.toLowerCase() &&
        prop.values.some((v) => v.toLowerCase().includes(value.toLowerCase())),
    ),
  );
}

/** The frontmatter text of a doc's content, or "". */
export function docFrontmatter(content: unknown): string {
  const first = (content as { content?: { type?: string; content?: { text?: string }[] }[] } | null)?.content?.[0];
  if (first?.type !== "frontmatter") return "";
  return (first.content ?? []).map((node) => node.text ?? "").join("");
}
