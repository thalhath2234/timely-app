import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

const KEYWORDS: Record<string, string[]> = {
  javascript: ["async","await","break","case","catch","class","const","continue","debugger","default","delete","do","else","export","extends","false","finally","for","from","function","if","import","in","instanceof","let","new","null","of","return","static","super","switch","this","throw","true","try","typeof","undefined","var","void","while","yield"],
  typescript: ["as","async","await","break","case","catch","class","const","continue","default","else","enum","export","extends","false","finally","for","from","function","if","implements","import","in","interface","let","new","null","of","private","protected","public","readonly","return","static","super","switch","this","throw","true","try","type","typeof","undefined","var","void","while"],
  python: ["and","as","assert","async","await","break","class","continue","def","del","elif","else","except","False","finally","for","from","global","if","import","in","is","lambda","None","not","or","pass","raise","return","True","try","while","with","yield"],
  go: ["break","case","chan","const","continue","default","defer","else","fallthrough","for","func","go","goto","if","import","interface","map","package","range","return","select","struct","switch","type","var"],
  rust: ["as","async","await","break","const","continue","crate","else","enum","extern","false","fn","for","if","impl","in","let","loop","match","mod","move","mut","pub","ref","return","self","Self","static","struct","super","trait","true","type","unsafe","use","where","while"],
  sql: ["and","as","asc","by","create","delete","desc","from","group","insert","into","join","left","limit","not","null","on","or","order","select","set","table","update","values","where"],
};

KEYWORDS.tsx = KEYWORDS.typescript;
KEYWORDS.jsx = KEYWORDS.javascript;
KEYWORDS.ts = KEYWORDS.typescript;
KEYWORDS.js = KEYWORDS.javascript;
KEYWORDS.py = KEYWORDS.python;

type Span = { from: number; to: number; className: string };

// Highlighting only helps code people read. Past this size a block is data
// (an STL model, a GeoJSON map), and coloring tens of thousands of numbers
// made every keystroke in the doc stall for seconds.
const MAX_HIGHLIGHT_CHARS = 20_000;

// Block comment | line comment | string | number | word, in one regex so a
// block is scanned once.
const TOKENS = {
  hash: /(\/\*[\s\S]*?(?:\*\/|$))|(#.*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)/g,
  slash: /(\/\*[\s\S]*?(?:\*\/|$))|(\/\/.*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)/g,
};

/** Token spans relative to the start of the block, in one linear pass. */
function tokenize(text: string, language: string): Span[] {
  const keywords = new Set(KEYWORDS[language] ?? KEYWORDS.javascript);
  const pattern = language === "python" || language === "py" ? TOKENS.hash : TOKENS.slash;
  const spans: Span[] = [];
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const from = match.index;
    const to = from + match[0].length;
    if (match[1] !== undefined || match[2] !== undefined) spans.push({ from, to, className: "tok-comment" });
    else if (match[3] !== undefined) spans.push({ from, to, className: "tok-string" });
    else if (match[4] !== undefined) spans.push({ from, to, className: "tok-number" });
    else if (keywords.has(match[0])) spans.push({ from, to, className: "tok-keyword" });
    else if (/^[A-Z]/.test(match[0])) spans.push({ from, to, className: "tok-type" });
    if (to === from) pattern.lastIndex += 1;
  }
  return spans;
}

// Unchanged code blocks keep the same node object between edits, so their
// tokens are computed once.
const cache = new WeakMap<ProseMirrorNode, Span[]>();

function decorate(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return;
    if (node.content.size > MAX_HIGHLIGHT_CHARS) return false;
    let spans = cache.get(node);
    if (!spans) {
      spans = tokenize(node.textContent, String(node.attrs.language ?? ""));
      cache.set(node, spans);
    }
    for (const span of spans) {
      decorations.push(Decoration.inline(pos + 1 + span.from, pos + 1 + span.to, { class: span.className }));
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

const highlightKey = new PluginKey<DecorationSet>("codeHighlight");

export const CodeHighlight = Extension.create({
  name: "codeHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: highlightKey,
        // Decorations used to be rebuilt on every state, selection moves
        // included; now only when the document changes.
        state: {
          init: (_, state) => decorate(state.doc),
          apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return highlightKey.getState(state);
          },
        },
      }),
    ];
  },
});
