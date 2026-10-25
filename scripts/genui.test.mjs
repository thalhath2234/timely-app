import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { describe } from "node:test";
import { genuiParser, genuiPrompt, replyText, splitReply } from "../packages/contract/src/genui.ts";

const prompt = genuiPrompt();

describe("reply card prompt", () => {
  test("the API's copy is up to date (make gen-genui-prompt)", () => {
    const file = new URL("../apps/api/internal/features/chat/genui_prompt.txt", import.meta.url);
    assert.equal(readFileSync(file, "utf8"), `${prompt}\n`);
  });

  test("lists every component and stays small", () => {
    for (const name of ["Reply(", "Card(", "TaskRow(", "Choices(", "DayStrip(", "Open("]) assert.ok(prompt.includes(name), name);
    // About four characters a token: keep the addition to every run near 2.5k tokens.
    assert.ok(prompt.length < 10000, `prompt is ${prompt.length} characters`);
  });

  test("its examples parse with no errors", () => {
    const programs = splitReply(prompt).filter((part) => part.kind === "ui");
    assert.equal(programs.length, 3);
    for (const { code } of programs) {
      const result = genuiParser().parse(code);
      assert.deepEqual(result.meta.errors, [], code);
      assert.equal(result.root?.typeName, "Reply");
      assert.deepEqual(result.meta.orphaned, []);
    }
  });
});

describe("splitReply", () => {
  const reply = 'Here is today.\n\n```openui-lang\nroot = Reply([c])\nc = Card("Today", [])\n```\n\nAnything else?';

  test("splits text and programs in order", () => {
    assert.deepEqual(splitReply(reply), [
      { kind: "text", text: "Here is today." },
      { kind: "ui", code: 'root = Reply([c])\nc = Card("Today", [])', closed: true },
      { kind: "text", text: "Anything else?" },
    ]);
  });

  test("keeps a cut-off program, marked open", () => {
    const parts = splitReply('Today:\n```openui-lang\nroot = Reply([c])\nc = Card("To');
    assert.equal(parts.length, 2);
    assert.equal(parts[1].kind, "ui");
    assert.equal(parts[1].closed, false);
  });

  test("leaves other code fences in the text", () => {
    const text = "Use this:\n```js\nconsole.log(1)\n```";
    assert.deepEqual(splitReply(text), [{ kind: "text", text }]);
  });

  test("replyText drops the programs", () => {
    assert.equal(replyText(reply), "Here is today.\n\nAnything else?");
    assert.equal(replyText("Plain answer"), "Plain answer");
  });
});

describe("parser", () => {
  test("flags components outside the list", () => {
    const result = genuiParser().parse('root = Reply([x])\nx = Script("alert(1)")');
    assert.ok(result.meta.errors.some((e) => e.code === "unknown-component"));
  });
});
