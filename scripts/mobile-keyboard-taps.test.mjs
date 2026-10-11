import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import test from "node:test";

const mobile = new URL("../apps/mobile/", import.meta.url).pathname;
const ts = createRequire(join(mobile, "package.json"))("typescript");
const scrollers = /^(ScrollView|FlatList|SectionList|Animated\.ScrollView|Animated\.FlatList)$/;

function tsxFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : tsxFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

// React Native's touch system walks the React tree, not the native one, so a
// sheet's Modal still has the screen's ScrollView as an ancestor. A scroller
// left on the default ("never") grabs the first tap while the keyboard is up
// and only closes the keyboard: a sheet's plus button then needs two taps.
test("every phone scroller lets taps through while the keyboard is up", () => {
  const missing = [];
  for (const file of [...tsxFiles(join(mobile, "app")), ...tsxFiles(join(mobile, "components"))]) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && scrollers.test(node.tagName.getText(source))) {
        const prop = node.attributes.properties.find((attr) => attr.name?.getText(source) === "keyboardShouldPersistTaps");
        const value = prop?.initializer?.getText(source);
        if (value !== '"handled"' && value !== '"always"') {
          const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          missing.push(`${relative(mobile, file)}:${line} ${node.tagName.getText(source)}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(missing, [], 'add keyboardShouldPersistTaps="handled" to these scrollers');
});
