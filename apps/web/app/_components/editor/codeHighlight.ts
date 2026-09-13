import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

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

function tokenize(text: string, language: string, start: number): Span[] {
  const keywords = new Set(KEYWORDS[language] ?? KEYWORDS.javascript);
  const spans: Span[] = [];
  const comment = language === "python" || language === "py" ? /#.*$/ : /\/\/.*$|\/\*[\s\S]*?\*\//;
  let i = 0;

  while (i < text.length) {
    const rest = text.slice(i);
    const at = start + i;

    if (rest.startsWith("/*")) {
      const end = text.indexOf("*/", i + 2);
      const to = end < 0 ? text.length : end + 2;
      spans.push({ from: at, to: start + to, className: "tok-comment" });
      i = to;
      continue;
    }

    const lineComment = language === "python" || language === "py" ? rest.match(/^#.*$/) : rest.match(/^\/\/.*$/);
    if (lineComment) {
      spans.push({ from: at, to: at + lineComment[0].length, className: "tok-comment" });
      i += lineComment[0].length;
      continue;
    }

    const string = rest.match(/^("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/);
    if (string) {
      spans.push({ from: at, to: at + string[0].length, className: "tok-string" });
      i += string[0].length;
      continue;
    }

    const number = rest.match(/^\b\d+(?:\.\d+)?\b/);
    if (number) {
      spans.push({ from: at, to: at + number[0].length, className: "tok-number" });
      i += number[0].length;
      continue;
    }

    const word = rest.match(/^[A-Za-z_][\w]*/);
    if (word) {
      if (keywords.has(word[0])) {
        spans.push({ from: at, to: at + word[0].length, className: "tok-keyword" });
      } else if (/^[A-Z]/.test(word[0])) {
        spans.push({ from: at, to: at + word[0].length, className: "tok-type" });
      }
      i += word[0].length;
      continue;
    }

    void comment;
    i += 1;
  }

  return spans;
}

export const CodeHighlight = Extension.create({
  name: "codeHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("codeHighlight"),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== "codeBlock") return;
              const language = String(node.attrs.language ?? "");
              for (const span of tokenize(node.textContent, language, pos + 1)) {
                decorations.push(Decoration.inline(span.from, span.to, { class: span.className }));
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
