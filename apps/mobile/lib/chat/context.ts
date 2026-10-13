import type { AssistantDraft, ChatContext } from "./types";

export function contextChip(
  kind: string,
  label: string,
  value: unknown,
): ChatContext {
  return {
    kind,
    label: Array.from(label).slice(0, 45).join(""),
    value: typeof value === "string" ? value : JSON.stringify(value),
  };
}
/** The project a chat's context chips point at: a project chip, or the
 * project the screen shows. Example prompts fit it. */
export function contextProjectId(chips: ChatContext[]): string | undefined {
  const project = chips.find((c) => c.kind === "project")?.value;
  if (project) return project;
  const object = chips.find(
    (c) => c.kind === "object" && c.value.startsWith("projects/"),
  )?.value;
  return object ? object.slice("projects/".length) || undefined : undefined;
}
export function mergeContext(
  current: ChatContext[],
  incoming: ChatContext[],
): ChatContext[] {
  const result = [...current];
  for (const chip of incoming)
    if (!result.some((c) => c.kind === chip.kind && c.value === chip.value))
      result.push(chip);
  // Silently dropping scope changes would make "these" ambiguous.
  if (result.length > 8)
    throw new Error(
      "Remove an existing context attachment before adding another screen (maximum eight).",
    );
  if (
    result.some(
      (c) =>
        encodeURIComponent(c.value).replace(/%[A-F\d]{2}/g, "x").length > 12000,
    )
  )
    throw new Error(
      "This screen's context is too large. Select a smaller range or fewer tasks.",
    );
  return result;
}
/**
 * The object a screen path shows, as [collection, id]. Docs and sheets live
 * under `/files/<id>`; the ID's prefix says which (sheet templates have no
 * object reference). Kept import-free so plain Node tests can load it.
 */
export function routeObject(path: string): [string, string] | null {
  const match = path.match(
    /\/(tasks|docs|sheets|projects|events|files)\/([^/]+)$/,
  );
  if (!match) return null;
  if (match[1] !== "files") return [match[1], match[2]];
  const id = match[2];
  if (id.startsWith("shtpl_")) return null;
  return [id.startsWith("sht_") ? "sheets" : "docs", id];
}

export function routeContext(
  path: string,
  params: Record<string, unknown>,
  entity?: {
    title?: string;
    name?: string;
    workspaceId?: string;
    projectId?: string | null;
  },
): ChatContext[] {
  const chips = [contextChip("location", "Current screen", path)];
  const match = routeObject(path);
  if (match && match[1] !== "new")
    chips.push(
      contextChip(
        "object",
        entity?.title || entity?.name || match[0],
        `${match[0]}/${match[1]}`,
      ),
    );
  const workspaceId = entity?.workspaceId || params.workspaceId;
  const projectId = entity?.projectId || params.projectId;
  if (typeof workspaceId === "string")
    chips.push(contextChip("workspace", "Workspace", workspaceId));
  if (typeof projectId === "string")
    chips.push(contextChip("project", "Project", projectId));
  return chips;
}

const screenOf = (chips: ChatContext[]) =>
  chips.find((c) => c.kind === "location")?.value;

/**
 * The draft a pinch opens. The pinch asks about the screen it was made on,
 * so a new chat always carries that screen's context: a draft left empty on
 * another screen (the assistant was opened and closed, or used to browse old
 * chats) is replaced, and typed text from another screen moves to this one.
 * A reply typed into an existing conversation, or a message already being
 * sent (it has a request ID), reopens as it was. `screen` is only called
 * when this screen's context is needed.
 */
export function draftForScreen(
  draft: AssistantDraft | null,
  screen: () => ChatContext[],
): AssistantDraft {
  const typed = !!draft && (!!draft.text || draft.images.length > 0);
  if (draft && (draft.requestId || (typed && draft.conversationId)))
    return draft;
  const context = screen();
  if (!draft) return { text: "", context, webSearch: false, images: [] };
  if (typed && screenOf(draft.context) === screenOf(context)) return draft;
  return {
    ...draft,
    text: typed ? draft.text : "",
    images: typed ? draft.images : [],
    context,
    conversationId: undefined,
  };
}
