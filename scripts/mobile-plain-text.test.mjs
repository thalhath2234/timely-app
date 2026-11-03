import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { createRequire } from "node:module";
import { isPlainText } from "../apps/mobile/lib/plainText.ts";

const { createElement } = createRequire(
  new URL("../apps/mobile/package.json", import.meta.url),
)("react");

// SheetOption wraps plain-text children in a <Text>. Settings → Agent built
// each model row from several strings ({name}{" · id"}{" · note"}), which the
// old `typeof children === "string"` check missed, so the phone drew the rows
// with no names at all.
describe("isPlainText", () => {
  test("a single string is plain text", () => {
    assert.equal(isPlainText("Claude Haiku 5.5"), true);
  });

  test("several strings and numbers are plain text", () => {
    assert.equal(isPlainText(["GPT-5", "  ·  openai/gpt-5", ""]), true);
    assert.equal(isPlainText(["Use “", "my-model", "”"]), true);
    assert.equal(isPlainText([3, " models"]), true);
  });

  test("empty conditionals do not stop a row from being text", () => {
    assert.equal(isPlainText(["GLM-5", null, false, undefined]), true);
  });

  test("elements are not plain text", () => {
    assert.equal(isPlainText(createElement("Text", null, "Default")), false);
    assert.equal(isPlainText(["Default", createElement("Text", null, "sub")]), false);
  });

  test("nothing is not plain text", () => {
    assert.equal(isPlainText(null), false);
    assert.equal(isPlainText([]), false);
  });
});
