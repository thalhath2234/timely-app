import type { Doc, DocContent } from "./documents";
import { fromMarkdown } from "./markdown";

/**
 * Doc templates, shared by web and mobile. Any doc can be a template (its
 * `isTemplate` flag); these built-in ones are always offered too. Text in a
 * template may hold {{date}}, {{time}}, {{weekday}} and {{title}}, filled in
 * when a doc is made from it, as in Obsidian.
 */

export interface DocTemplate {
  /** "builtin:<name>" or the template doc's id. */
  id: string;
  title: string;
  icon: string;
  /** Built-ins only; a doc template uses its own content. */
  markdown?: string;
  content?: DocContent;
}

export const DAILY_NOTE_TEMPLATE_TITLE = "Daily note";

export const BUILTIN_TEMPLATES: DocTemplate[] = [
  {
    id: "builtin:daily",
    title: DAILY_NOTE_TEMPLATE_TITLE,
    icon: "📅",
    markdown: `---
date: {{date}}
tags: daily
---

## Top three

- [ ] First thing
- [ ] Second thing
- [ ] Third thing

## Notes

Write here.

## Done today

- Nothing yet
`,
  },
  {
    id: "builtin:meeting",
    title: "Meeting notes",
    icon: "🗓️",
    markdown: `---
date: {{date}}
attendees: []
tags: meeting
---

## Agenda

1. First topic

## Notes

Write here.

## Decisions

- None yet

## Action items

- [ ] Who does what, by when
`,
  },
  {
    id: "builtin:project",
    title: "Project plan",
    icon: "🚀",
    markdown: `---
status: draft
owner:
tags: project
---

## Goal

What is this project for, and how will we know it worked?

## Scope

- In: the parts we will do
- Out: the parts we will not

## Milestones

- [ ] First milestone

## Risks

> [!WARNING]
>
> What could go wrong, and what we will do about it.
`,
  },
  {
    id: "builtin:weekly",
    title: "Weekly review",
    icon: "🔁",
    markdown: `---
week: {{date}}
tags: review
---

## What went well

- 

## What did not

- 

## Next week

- [ ] The one thing that matters most
`,
  },
];

export interface TemplateVars {
  date: string;
  time: string;
  weekday: string;
  title: string;
}

/** Template values for now, in the device's own time zone. */
export function templateVars(now = new Date(), title = ""): TemplateVars {
  return {
    date: dateKey(now),
    time: now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    weekday: now.toLocaleDateString(undefined, { weekday: "long" }),
    title,
  };
}

/** YYYY-MM-DD of a local date: the daily note's key and default title. */
export function dateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fill(text: string, vars: TemplateVars) {
  return text.replace(/\{\{\s*(date|time|weekday|title)\s*\}\}/g, (_whole, key: keyof TemplateVars) => vars[key]);
}

function fillNode(node: unknown, vars: TemplateVars): unknown {
  if (Array.isArray(node)) return node.map((child) => fillNode(child, vars));
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = key === "text" && typeof value === "string" ? fill(value, vars) : fillNode(value, vars);
  }
  return out;
}

function plainOf(node: unknown): string[] {
  if (!node || typeof node !== "object") return [];
  const record = node as { text?: string; content?: unknown[] };
  if (typeof record.text === "string") return [record.text];
  return (record.content ?? []).flatMap(plainOf);
}

/** The content and plain text for a new doc made from a template. */
export function contentFromTemplate(template: DocTemplate, vars: TemplateVars): { content: DocContent; plainText: string } {
  const source = template.content ?? (template.markdown ? fromMarkdown(template.markdown).content : { type: "doc", content: [] });
  const content = fillNode(source, vars) as DocContent;
  return { content, plainText: plainOf(content).join("\n") };
}

/** Built-ins plus the user's own template docs (theirs first). */
export function availableTemplates(docs: Doc[]): DocTemplate[] {
  const own = docs
    .filter((doc) => doc.isTemplate && !doc.archivedAt)
    .map((doc) => ({ id: doc.id, title: doc.title || "Untitled", icon: doc.icon || "📄", content: doc.content }));
  return [...own, ...BUILTIN_TEMPLATES];
}

/** The template a new daily note uses: the user's own "Daily note"
 * template when there is one, else the built-in. */
export function dailyNoteTemplate(docs: Doc[]): DocTemplate {
  const own = docs.find(
    (doc) => doc.isTemplate && !doc.archivedAt && doc.title.trim().toLowerCase() === DAILY_NOTE_TEMPLATE_TITLE.toLowerCase(),
  );
  if (own) return { id: own.id, title: own.title, icon: own.icon || "📅", content: own.content };
  return BUILTIN_TEMPLATES[0];
}
