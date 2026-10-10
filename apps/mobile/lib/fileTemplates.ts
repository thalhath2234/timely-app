import type { DocTemplate } from "@timely/contract/templates";
import type { SheetTemplate } from "./types";

/** One row of the new doc or sheet picker: an icon, a name and one line
 * saying what it holds. */
export type TemplateChoice = {
  id: string;
  name: string;
  /** An emoji, when the template has one. */
  icon?: string;
  description: string;
  /** The person's own template rather than a built-in. */
  mine: boolean;
};

const BUILTIN_DESCRIPTIONS: Record<string, string> = {
  "builtin:daily": "Top three, notes and what got done",
  "builtin:meeting": "Agenda, notes, decisions and action items",
  "builtin:project": "Goal, scope, milestones and risks",
  "builtin:weekly": "What went well, what did not, next week",
};

/** The first words of a template's text, on one line. */
export function oneLine(text: string, max = 60) {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** Doc templates as picker rows (the person's own first, as
 * availableTemplates orders them). Own templates are described by their text. */
export function docTemplateChoices(templates: DocTemplate[], plainTextById: Map<string, string> = new Map()): TemplateChoice[] {
  return templates.map((template) => {
    const mine = !template.id.startsWith("builtin:");
    const description = mine ? oneLine(plainTextById.get(template.id) ?? "") || "Your template" : BUILTIN_DESCRIPTIONS[template.id] ?? "Built-in template";
    return { id: template.id, name: template.title || "Untitled", icon: template.icon || undefined, description, mine };
  });
}

/** Sheet templates as picker rows, described by their first column names. */
export function sheetTemplateChoices(templates: Pick<SheetTemplate, "id" | "name" | "icon" | "columns" | "tabs">[]): TemplateChoice[] {
  return templates.map((template) => {
    const columns = template.columns?.length ? template.columns : template.tabs?.[0]?.columns ?? [];
    const names = columns.map((column) => column.name.trim()).filter(Boolean);
    let description = names.length
      ? names.slice(0, 4).join(", ") + (names.length > 4 ? ` +${names.length - 4}` : "")
      : `${columns.length} ${columns.length === 1 ? "column" : "columns"}`;
    const tabs = template.tabs?.length ?? 0;
    if (tabs > 1) description += ` · ${tabs} tabs`;
    return { id: template.id, name: template.name || "Untitled", icon: template.icon || undefined, description, mine: true };
  });
}

/** Puts the suggested template first, out of the list, when it is one of
 * the offered choices. */
export function withSuggestion(choices: TemplateChoice[], suggestedId?: string) {
  const suggested = suggestedId ? choices.find((choice) => choice.id === suggestedId) : undefined;
  return { suggested, rest: suggested ? choices.filter((choice) => choice !== suggested) : choices };
}

/** The title to ask suggestions about, or "" when there is nothing to ask:
 * under two letters, or still "Untitled". */
export function suggestionTitle(title: string) {
  const trimmed = title.trim();
  if ([...trimmed].length < 2 || trimmed.toLowerCase() === "untitled") return "";
  return trimmed;
}

/** A doc made from a template takes the typed name; with none, a built-in
 * keeps its own name and a copy of the person's template says so. */
export function docTitleFromTemplate(template: Pick<DocTemplate, "id" | "title">, typed: string) {
  const name = typed.trim();
  if (name) return name;
  return template.id.startsWith("builtin:") ? template.title : `${template.title} copy`;
}

/** Whether the person kept the suggestion: undefined when there was none
 * to keep (no suggestion, or no decision logged). */
export function suggestionKept(suggestedId: string | undefined, pickedId: string | undefined) {
  if (!suggestedId) return undefined;
  return pickedId === suggestedId;
}
