"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Extension } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, type Editor, type NodeViewProps } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { Code2, Sparkles, Trash2 } from "lucide-react";
import { LIVE_BLOCK_LANGUAGE, readBoardProgram } from "@timely/contract/genuiBoard";
import DescribeCardDialog, { type DescribedResult } from "@/app/_components/report/describeCardDialog";
import { LiveBlockBody, LiveBlockFrame } from "@/app/_components/report/liveBlockFrame";

/*
 * Live blocks: a described card inside a doc. The doc keeps the program as
 * an ```openui-lang code block, so it stays Markdown; here it is drawn from
 * the person's own data each time the doc shows, and the AI is asked again
 * only when the person changes it. The code stays hidden unless asked for or
 * the caret is in it.
 */

/** Whether the caret is inside the node at pos, kept current as the selection moves. */
function useCaretInside(editor: Editor, getPos: NodeViewProps["getPos"], size: number) {
  const [inside, setInside] = useState(false);
  useEffect(() => {
    const read = () => {
      const pos = getPos();
      if (typeof pos !== "number") return setInside(false);
      const { from, to } = editor.state.selection;
      setInside(editor.isFocused && from > pos && to < pos + size);
    };
    read();
    editor.on("selectionUpdate", read);
    editor.on("focus", read);
    editor.on("blur", read);
    return () => {
      editor.off("selectionUpdate", read);
      editor.off("focus", read);
      editor.off("blur", read);
    };
  }, [editor, getPos, size]);
  return inside;
}

const isLive = (node: PMNode | null | undefined) => node?.type.name === "codeBlock" && node.attrs.language === LIVE_BLOCK_LANGUAGE;

/** For getText: a block's program is code for the app, not words to count or search. */
export const LIVE_BLOCK_TEXT = {
  codeBlock: ({ node }: { node: PMNode }) => (isLive(node) ? "" : node.textContent),
};

/**
 * Backspace at the start of the line after a live block, or Delete at the
 * end of the line before one, selects the block (an empty line goes)
 * instead of joining the text into its hidden program.
 */
export const LiveBlockKeys = Extension.create({
  name: "liveBlockKeys",
  // Ahead of the editor's own Backspace, which would join the line into the block.
  priority: 1000,
  addKeyboardShortcuts() {
    const step = (editor: Editor, dir: -1 | 1) => {
      const { selection } = editor.state;
      if (!selection.empty) return false;
      const { $from } = selection;
      if (!$from.parent.isTextblock || $from.depth === 0) return false;
      if (dir < 0 ? $from.parentOffset !== 0 : $from.parentOffset !== $from.parent.content.size) return false;
      const container = $from.node($from.depth - 1);
      const index = $from.index($from.depth - 1) + dir;
      if (index < 0 || index >= container.childCount) return false;
      const block = container.child(index);
      if (!isLive(block)) return false;
      const lineStart = $from.before();
      let at = dir < 0 ? lineStart - block.nodeSize : $from.after();
      const tr = editor.state.tr;
      if ($from.parent.content.size === 0) {
        tr.delete(lineStart, $from.after());
        if (dir > 0) at = lineStart;
      }
      editor.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, at)).scrollIntoView());
      return true;
    };
    return {
      Backspace: ({ editor }) => step(editor, -1),
      Delete: ({ editor }) => step(editor, 1),
    };
  },
});

/** An ```openui-lang code block in the editor, drawn as its live block. */
export default function LiveBlockView({ node, editor, getPos, deleteNode, selected }: NodeViewProps) {
  const program = node.textContent;
  const empty = !program.trim();
  const read = useMemo(() => (empty ? null : readBoardProgram(program)), [program, empty]);
  const [codeOpen, setCodeOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const caretInside = useCaretInside(editor, getPos, node.nodeSize);
  const editable = editor.isEditable;
  const showCode = empty || codeOpen || caretInside;
  const title = read?.title || "Live block";
  const wrapRef = useRef<HTMLDivElement>(null);

  // A press on the drawn card is the card's own: the editor neither moves
  // the caret into the hidden program nor starts a selection. Its buttons,
  // ticks and links still get their clicks.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".doc-live-head, .doc-live-body, .doc-live-empty")) return;
      if (target.closest("button, a, input, select, textarea, [role=button], [role=checkbox], [role=link]")) return;
      event.preventDefault();
      event.stopPropagation();
    };
    wrap.addEventListener("mousedown", onDown);
    return () => wrap.removeEventListener("mousedown", onDown);
  }, []);

  const replace = (result: DescribedResult) => {
    setChanging(false);
    const pos = getPos();
    if (typeof pos !== "number") return;
    const current = editor.state.doc.nodeAt(pos);
    if (!current || current.type.name !== "codeBlock") return;
    editor.view.dispatch(editor.state.tr.replaceWith(pos + 1, pos + current.nodeSize - 1, editor.schema.text(result.program)));
  };

  const actions = (
    <>
      {editable ? (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setChanging(true)}
          className="doc-code-copy"
        >
          <Sparkles className="size-3.5" />
          {empty ? "Describe" : "Change"}
        </button>
      ) : null}
      {empty ? null : (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setCodeOpen((open) => !open)}
          className="doc-code-copy"
          aria-pressed={showCode}
          aria-label={showCode ? "Hide the block's code" : "Show the block's code"}
          title={showCode ? "Hide code" : "Show code"}
        >
          <Code2 className="size-3.5" />
        </button>
      )}
      {editable ? (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            deleteNode();
            editor.commands.focus();
          }}
          className="doc-code-copy doc-code-delete"
          aria-label="Delete live block"
          title="Delete live block"
        >
          <Trash2 className="size-3.5" />
        </button>
      ) : null}
    </>
  );

  return (
    <NodeViewWrapper
      ref={wrapRef}
      className={`doc-code-wrap doc-live${selected ? " is-selected" : ""}`}
      data-language={LIVE_BLOCK_LANGUAGE}
      role="group"
      aria-label={`Live block: ${title}`}
    >
      <LiveBlockFrame title={title} program={program} actions={actions}>
        {empty ? (
          <p className="doc-live-empty" contentEditable={false}>
            Describe what this block should show, or write its program below.
          </p>
        ) : (
          <LiveBlockBody program={program} />
        )}
      </LiveBlockFrame>
      <pre className={`doc-code-block language-${LIVE_BLOCK_LANGUAGE}${showCode ? "" : " is-hidden"}`}>
        <NodeViewContent />
      </pre>
      {changing ? (
        <DescribeCardDialog
          place="doc"
          initial={empty ? undefined : { title: read?.title ?? "", prompt: "", program, w: 4, h: 3 }}
          onSave={replace}
          onClose={() => setChanging(false)}
        />
      ) : null}
    </NodeViewWrapper>
  );
}

/**
 * Puts a new live block where the caret was: in place of an empty line, or
 * after the caret's block, with a line after it to carry on writing.
 */
export function insertLiveBlock(editor: Editor, at: number, program: string) {
  const { state } = editor;
  const block = state.schema.nodes.codeBlock.create({ language: LIVE_BLOCK_LANGUAGE }, state.schema.text(program));
  const $at = state.doc.resolve(Math.max(0, Math.min(at, state.doc.content.size)));
  const tr = state.tr;
  let start: number;
  if ($at.depth > 0 && $at.parent.isTextblock && $at.parent.content.size === 0) {
    start = $at.before();
    tr.replaceWith(start, $at.after(), block);
  } else {
    start = $at.depth > 0 ? $at.after() : $at.pos;
    tr.insert(start, block);
  }
  const after = start + block.nodeSize;
  const next = tr.doc.nodeAt(after);
  if (!next || next.type.name !== "paragraph") tr.insert(after, state.schema.nodes.paragraph.create());
  tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView();
  editor.view.dispatch(tr);
  editor.commands.focus();
}
