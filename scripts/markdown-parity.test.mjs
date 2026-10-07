import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fromMarkdown } from "../packages/contract/src/markdown.ts";

// The API's richtext package exports testdata/parity.json as
// testdata/parity.md; importing that file here must give the doc back.
const dir = new URL("../apps/api/internal/richtext/testdata/", import.meta.url);
const doc = JSON.parse(readFileSync(new URL("parity.json", dir), "utf8"));
const md = readFileSync(new URL("parity.md", dir), "utf8");

/** Drops null and default attrs, sorts marks and joins adjacent text with
 * the same marks (mirrors normalizeDoc in parity_test.go). */
function normalize(node) {
  if (!node || typeof node !== "object") return node;
  const out = { ...node };
  if (out.attrs) {
    const attrs = Object.fromEntries(
      Object.entries(out.attrs).filter(
        ([key, value]) => value !== null && value !== undefined && !(key === "appearance" && value === "mention"),
      ),
    );
    if (Object.keys(attrs).length) out.attrs = attrs;
    else delete out.attrs;
  }
  if (out.marks) out.marks = [...out.marks].sort((a, b) => a.type.localeCompare(b.type));
  if (out.content) {
    const merged = [];
    for (const child of out.content.map(normalize)) {
      const prev = merged[merged.length - 1];
      if (prev?.type === "text" && child.type === "text" && JSON.stringify(prev.marks) === JSON.stringify(child.marks)) {
        prev.text += child.text;
      } else {
        merged.push(child);
      }
    }
    if (merged.length) out.content = merged;
    else delete out.content;
  }
  return out;
}

test("importing the exported Markdown gives the same doc", () => {
  assert.deepEqual(normalize(fromMarkdown(md).content), normalize(doc));
});

test("plain text keeps the literal characters", () => {
  const { plainText } = fromMarkdown(md);
  assert.match(plainText, /Literal \*stars\*/);
  assert.match(plainText, /@Haircut/);
});

test("soft line breaks are spaces unless breaks is set", () => {
  const joined = fromMarkdown("one\ntwo").content.content[0].content;
  assert.deepEqual(joined, [{ type: "text", text: "one two" }]);
  const kept = fromMarkdown("one\ntwo", { breaks: true }).content.content[0].content;
  assert.deepEqual(kept.map((node) => node.type), ["text", "hardBreak", "text"]);
});
