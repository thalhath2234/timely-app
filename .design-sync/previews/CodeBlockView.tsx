import { useEffect, useRef } from "react";
import { CodeBlockView } from "@timely/ui";

// CodeBlockView is a TipTap node view: outside an editor its NodeViewContent is
// an empty element (the editor normally mounts the code text into it). The
// cells below fill that element with pre-highlighted code using the same
// `tok-*` classes the editor's highlighter emits.
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const t = (cls: string, s: string) => `<span class="tok-${cls}">${esc(s)}</span>`;

function Block({ language, html, text }: { language: string; html: string; text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const content = ref.current?.querySelector("[data-node-view-content]");
    if (content) content.innerHTML = html;
  }, [html]);
  const node = { attrs: { language }, textContent: text };
  return (
    <div ref={ref} className="p-4" style={{ width: 560 }}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <CodeBlockView {...({ node, updateAttributes: () => {}, deleteNode: () => {}, selected: false } as any)} />
    </div>
  );
}

const ts = [
  `${t("keyword", "export")} ${t("keyword", "async")} ${t("keyword", "function")} scheduleOnboarding(taskId: ${t("type", "string")}) {`,
  `  ${t("comment", "// First free 2h slot in this week's focus blocks")}`,
  `  ${t("keyword", "const")} slot = ${t("keyword", "await")} findSlot({`,
  `    minutes: ${t("number", "120")},`,
  `    before: ${t("string", '"friday"')},`,
  `  });`,
  `  ${t("keyword", "return")} pinBlock(taskId, slot.start, slot.end);`,
  `}`,
].join("\n");

const sql = [
  `${t("keyword", "SELECT")} title, duration, due_at`,
  `${t("keyword", "FROM")} tasks`,
  `${t("keyword", "WHERE")} project_id = ${t("string", "'website-relaunch'")}`,
  `  ${t("keyword", "AND")} status <> ${t("string", "'done'")}`,
  `${t("keyword", "ORDER BY")} due_at ${t("keyword", "LIMIT")} ${t("number", "10")};`,
].join("\n");

const plain = `Release checklist
- Freeze copy on Thursday
- QA staging build
- Ship Friday 10:00`;

export const TypeScript = () => (
  <Block language="typescript" html={ts} text={ts.replace(/<[^>]+>/g, "")} />
);

export const Sql = () => <Block language="sql" html={sql} text={sql} />;

export const PlainText = () => <Block language="" html={esc(plain)} text={plain} />;
