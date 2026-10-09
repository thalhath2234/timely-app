"use client";

import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { Plus, Sparkles, X } from "lucide-react";
import { contentFromTemplate, templateVars } from "@timely/contract/templates";
import type { Doc } from "@/app/_types/types";
import { getDoc } from "@/app/utils/api/docs";
import { useDecisionFeedback, useDocHints } from "@/app/utils/hooks/decisions";
import { useUpdateDoc } from "@/app/utils/hooks/docs";
import { useCreateTask } from "@/app/utils/hooks/tasks";
import { setDocProperty } from "@/app/_components/editor/frontmatter";
import { showUndoToast, useToastStore } from "@/app/_store/toastStore";

/** What smart suggestions read in a doc: a template for a near-empty page,
 * the project or page it may belong under, its type and properties, lines
 * that read like something to do, and whether it looks out of date. Nothing
 * shows while suggestions are off, and every row can be dismissed. */
export default function DocHints({
  doc,
  editor,
  version,
  nearEmpty,
  onApplyContent,
}: {
  doc: Doc;
  editor: Editor | null;
  version: string;
  /** A template is only offered while the page is still near-empty. */
  nearEmpty: boolean;
  onApplyContent: (content: Doc["content"], plainText: string) => void;
}) {
  const { data } = useDocHints(doc.id, version, !doc.isTemplate && !doc.archivedAt);
  const updateDoc = useUpdateDoc();
  const createTask = useCreateTask();
  const feedback = useDecisionFeedback();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState(false);
  if (!data?.available) return null;

  const hide = (key: string) => setHidden((prev) => new Set(prev).add(key));
  const accept = () => {
    if (data.logId && !sent) {
      setSent(true);
      feedback.mutate({ logId: data.logId, accepted: true });
    }
  };

  const template = data.template && nearEmpty && !hidden.has("template") ? data.template : undefined;
  const project = data.project && !doc.projectId && !hidden.has("project") ? data.project : undefined;
  const parent = data.parent && !doc.parentId && !hidden.has("parent") ? data.parent : undefined;
  const docType = data.docType && !hidden.has("type") ? data.docType : undefined;
  const properties = (data.properties ?? []).filter((p) => !hidden.has(`prop:${p.key}`));
  const work = (data.work ?? []).filter((line) => !hidden.has(`work:${line}`));
  const outdated = data.outdated && !hidden.has("outdated");
  if (!template && !project && !parent && !docType && !properties.length && !work.length && !outdated) return null;

  const dismiss = (key: string) => (
    <button
      type="button"
      aria-label="Dismiss"
      onClick={() => hide(key)}
      className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <X className="size-3.5" />
    </button>
  );
  const button = "shrink-0 rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50";
  const strong = "font-medium text-foreground";

  return (
    <section className="mb-4 rounded-xl border border-border bg-card p-3" data-testid="doc-hints" aria-label="Doc suggestions">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Sparkles className="size-3.5" /> Suggestions
      </h3>
      <ul className="mt-1.5 flex flex-col gap-0.5 text-sm text-muted-foreground">
        {template && (
          <li className="flex items-center gap-2 rounded-md px-1 py-1">
            <span className="min-w-0 flex-1">
              Start from the <strong className={strong}>{template.title}</strong> template?
            </span>
            <button
              type="button"
              className={button}
              onClick={async () => {
                try {
                  const source = await getDoc(template.id);
                  const { content, plainText } = contentFromTemplate(
                    { id: source.id, title: source.title, icon: source.icon || "📄", content: source.content },
                    templateVars(new Date(), doc.title || source.title),
                  );
                  onApplyContent(content, plainText);
                  accept();
                  hide("template");
                } catch {
                  useToastStore.getState().show("Could not open that template");
                }
              }}
            >
              Use template
            </button>
            {dismiss("template")}
          </li>
        )}
        {project && (
          <li className="flex items-center gap-2 rounded-md px-1 py-1">
            <span className="min-w-0 flex-1">
              Looks like part of the <strong className={strong}>{project.title}</strong> project.
            </span>
            <button
              type="button"
              className={button}
              onClick={() => {
                updateDoc.mutate({ id: doc.id, projectId: project.id });
                accept();
                hide("project");
                showUndoToast(`Added to ${project.title}`, () => updateDoc.mutate({ id: doc.id, projectId: "" }));
              }}
            >
              Add to project
            </button>
            {dismiss("project")}
          </li>
        )}
        {parent && (
          <li className="flex items-center gap-2 rounded-md px-1 py-1">
            <span className="min-w-0 flex-1">
              Could live under <strong className={strong}>{parent.title}</strong>.
            </span>
            <button
              type="button"
              className={button}
              onClick={() => {
                updateDoc.mutate({ id: doc.id, parentId: parent.id });
                accept();
                hide("parent");
                showUndoToast(`Moved under ${parent.title}`, () => updateDoc.mutate({ id: doc.id, parentId: "" }));
              }}
            >
              Move
            </button>
            {dismiss("parent")}
          </li>
        )}
        {docType && (
          <li className="flex items-center gap-2 rounded-md px-1 py-1">
            <span className="min-w-0 flex-1">
              Reads like a <strong className={strong}>{docType}</strong>.
            </span>
            <button
              type="button"
              className={button}
              disabled={!editor}
              onClick={() => {
                if (!editor) return;
                setDocProperty(editor, "type", docType);
                accept();
                hide("type");
              }}
            >
              Set type
            </button>
            {dismiss("type")}
          </li>
        )}
        {properties.map((p) => (
          <li key={p.key} className="flex items-center gap-2 rounded-md px-1 py-1">
            <span className="min-w-0 flex-1">
              Set <strong className={strong}>{p.key}</strong> to <strong className={strong}>{p.value}</strong>, as in your other docs?
            </span>
            <button
              type="button"
              className={button}
              disabled={!editor}
              onClick={() => {
                if (!editor) return;
                setDocProperty(editor, p.key, p.value);
                accept();
                hide(`prop:${p.key}`);
              }}
            >
              Set
            </button>
            {dismiss(`prop:${p.key}`)}
          </li>
        ))}
        {work.map((line) => (
          <li key={line} className="flex items-center gap-2 rounded-md px-1 py-1">
            <span className="min-w-0 flex-1">
              <strong className={strong}>{line}</strong> reads like a task.
            </span>
            <button
              type="button"
              className={`${button} inline-flex items-center gap-1`}
              onClick={() => {
                createTask.mutate(
                  { name: line, kind: "task", duration: 30, workspaceId: doc.workspaceId, projectId: doc.projectId ?? undefined },
                  { onSuccess: () => useToastStore.getState().show(`Task added: ${line}`) },
                );
                accept();
                hide(`work:${line}`);
              }}
            >
              <Plus className="size-3" /> Create task
            </button>
            {dismiss(`work:${line}`)}
          </li>
        ))}
        {outdated && (
          <li className="flex items-center gap-2 rounded-md px-1 py-1">
            <span className="min-w-0 flex-1">This doc may be out of date. It has not been edited in a while and talks about plans or dates that have likely passed.</span>
            {dismiss("outdated")}
          </li>
        )}
      </ul>
    </section>
  );
}
