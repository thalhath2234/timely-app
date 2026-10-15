import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import test from "node:test";

const mobile = new URL("../apps/mobile/", import.meta.url).pathname;
const ts = createRequire(join(mobile, "package.json"))("typescript");
const scrollers = /^(ScrollView|FlatList|SectionList|Animated\.ScrollView|Animated\.FlatList|WebView)$/;

function tsxFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : tsxFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

// The phone app never shows a scrollbar. React Native has no app-wide switch,
// so every scroller turns off the indicator for the way it scrolls (a WebView
// for both), and the editor page and Expo web hide theirs with CSS.
test("every phone scroller hides its scrollbar", () => {
  const missing = [];
  for (const file of [...tsxFiles(join(mobile, "app")), ...tsxFiles(join(mobile, "components"))]) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && scrollers.test(node.tagName.getText(source))) {
        const attrs = node.attributes.properties;
        const value = (name) => attrs.find((attr) => attr.name?.getText(source) === name)?.initializer?.getText(source);
        const tag = node.tagName.getText(source);
        const horizontal = attrs.some((attr) => attr.name?.getText(source) === "horizontal");
        const needed =
          tag === "WebView"
            ? ["showsVerticalScrollIndicator", "showsHorizontalScrollIndicator"]
            : [horizontal ? "showsHorizontalScrollIndicator" : "showsVerticalScrollIndicator"];
        for (const name of needed) {
          if (value(name) !== "{false}") {
            const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
            missing.push(`${relative(mobile, file)}:${line} ${tag} ${name}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(missing, [], "set these to {false}");
});

test("the editor page and Expo web hide scrollbars with CSS", () => {
  for (const file of ["components/editor/editorHtml.ts", "app/+html.tsx"]) {
    const text = readFileSync(join(mobile, file), "utf8");
    assert.match(text, /scrollbar-width: none/, file);
    assert.match(text, /::-webkit-scrollbar \{[^}]*display: none/, file);
  }
});
