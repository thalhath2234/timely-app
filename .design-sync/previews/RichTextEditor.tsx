import { RichTextEditor } from "@timely/ui";
import { useEffect, useState } from "react";

/** Loads a sample doc's content, as the doc page does. */
function DocBody({ docId, toolbar = "fixed" }: { docId: string; toolbar?: "fixed" | "float" }) {
  const [content, setContent] = useState<any>(null);
  useEffect(() => {
    void fetch(`/api-proxy/docs/${docId}`)
      .then((r) => r.json())
      .then((doc) => setContent(doc.content));
  }, [docId]);
  return (
    <div className="bg-background px-10 py-6" style={{ width: 820, height: 640, overflow: "hidden" }}>
      {content && <RichTextEditor toolbar={toolbar} content={content} syncKey={docId} onChange={() => {}} />}
    </div>
  );
}

export const DocPage = () => <DocBody docId="doc_research_synthesis" />;

export const ChecklistsAndMentions = () => <DocBody docId="doc_weekly_notes" toolbar="float" />;

const description = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Pair with Dev on the naming before Thursday's design review. Open questions:" }],
    },
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Keep a 6px step for the data grid?" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Radius for chips: control or pill?" }] }] },
      ],
    },
  ],
};

export const TaskDescription = () => (
  <div className="rounded-xl border border-border bg-card p-4" style={{ width: 520 }}>
    <RichTextEditor variant="compact" toolbar="fixed" content={description} placeholder="Description" onChange={() => {}} />
  </div>
);

export const EmptyDescription = () => (
  <div className="rounded-xl border border-border bg-card p-4" style={{ width: 520 }}>
    <RichTextEditor variant="compact" toolbar="fixed" content={{ type: "doc", content: [{ type: "paragraph" }] }} placeholder="Description" onChange={() => {}} />
  </div>
);
