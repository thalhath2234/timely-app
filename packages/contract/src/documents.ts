/** ProseMirror document tree as produced by the Tiptap editor. */
export interface DocContent {
  type?: string;
  content?: unknown[];
  [key: string]: unknown;
}

/**
 * Entities that can be @-mentioned from inside any rich text field. The server
 * parses mention nodes (`internal/richtext`), so these values are part of the
 * contract.
 */
export type MentionEntityType = "doc" | "sheet" | "task" | "project";

export type MentionAppearance = "mention" | "page";

export interface MentionAttrs {
  id: string;
  label: string;
  entityType: MentionEntityType;
  /** "page" is a subpage link: the title is shown and acts as a hyperlink. */
  appearance?: MentionAppearance;
}

export interface Doc {
  id: string;
  title: string;
  icon: string | null;
  content: DocContent;
  plainText: string;
  parentId: string | null;
  workspaceId: string;
  projectId: string | null;
  userId: string;
  isFavorite: boolean;
  archivedAt: string | null;
  order: number;
  /** Offered under "New from template". */
  isTemplate?: boolean;
  /** YYYY-MM-DD when this is the daily note for that day. */
  dailyDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * POST /docs (`createDocumentRequest`). `workspaceId` is a plain string on the
 * server: empty (omitted) means the account's default workspace. `null` for
 * `parentId`/`projectId` is the same as omitting them.
 */
export interface CreateDocPayload {
  title?: string;
  icon?: string;
  content?: DocContent;
  plainText?: string;
  parentId?: string | null;
  workspaceId?: string;
  projectId?: string | null;
}

/**
 * PUT /docs/:id (`updateDocumentRequest`). Fields are pointers on the server:
 * absent or `null` leaves the value alone, and an empty string clears
 * `parentId` (moves to the root) and `projectId`.
 */
export interface UpdateDocPayload {
  title?: string;
  icon?: string;
  content?: DocContent;
  plainText?: string;
  parentId?: string;
  projectId?: string;
  isFavorite?: boolean;
  archived?: boolean;
  order?: number;
  isTemplate?: boolean;
}

/** POST /docs/daily: opens the daily note for `date` (the user's own day),
 * creating it from `content` when there is none yet. */
export interface DailyDocPayload {
  date: string;
  title?: string;
  content?: DocContent;
  plainText?: string;
  workspaceId?: string;
}

/** GET /docs/:id/backlinks: another doc linking here, with the text around each link. */
export interface DocBacklink {
  id: string;
  title: string;
  icon: string | null;
  snippets: string[];
}

/** A saved state of a doc (GET /docs/:id/versions). `content` is only on
 * GET /docs/:id/versions/:versionId. `reason` is why it was saved: "edit"
 * (editing started again after a pause), "assistant" (just before the
 * assistant changed the doc) or "restore" (just before an older version was
 * put back). */
export interface DocVersion {
  id: string;
  documentId: string;
  title: string;
  words: number;
  reason: "edit" | "assistant" | "restore" | string;
  editedAt: string;
  createdAt: string;
  content?: DocContent;
  plainText?: string;
}

export const DOC_VERSION_REASONS: Record<string, string> = {
  edit: "Edited",
  assistant: "Before an assistant change",
  restore: "Before a restore",
};

/** A row of a page picker: the doc, how deep it sits, and its parents' titles. */
export interface PageChoice<T> {
  doc: T;
  depth: number;
  path: string[];
}

type PageLike = { id: string; title: string; parentId: string | null; archivedAt: string | null; isTemplate?: boolean; order: number };

/**
 * Pages to pick from (Copy to / Move to page): live docs as the sidebar
 * nests them, subpages under their parent; with a query, every page whose
 * title matches, with its parents' titles to tell them apart.
 */
export function pageChoices<T extends PageLike>(docs: T[], query = ""): PageChoice<T>[] {
  const live = docs.filter((doc) => !doc.archivedAt && !doc.isTemplate);
  const byId = new Map(live.map((doc) => [doc.id, doc]));
  const children = new Map<string | null, T[]>();
  for (const doc of live) {
    const parent = doc.parentId && byId.has(doc.parentId) ? doc.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), doc]);
  }
  for (const list of children.values()) list.sort((a, b) => a.order - b.order || (a.title || "").localeCompare(b.title || ""));

  const out: PageChoice<T>[] = [];
  const walk = (parent: string | null, path: string[]) => {
    for (const doc of children.get(parent) ?? []) {
      // Guards against a parent loop in bad data.
      if (out.length > live.length) return;
      out.push({ doc, depth: path.length, path });
      walk(doc.id, [...path, doc.title || "Untitled"]);
    }
  };
  walk(null, []);

  const needle = query.trim().toLowerCase();
  if (!needle) return out;
  return out.filter((row) => (row.doc.title || "Untitled").toLowerCase().includes(needle)).map((row) => ({ ...row, depth: 0 }));
}
