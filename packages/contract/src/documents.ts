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
}

/** GET /docs/:id/backlinks: another doc linking here, with the text around each link. */
export interface DocBacklink {
  id: string;
  title: string;
  icon: string | null;
  snippets: string[];
}
