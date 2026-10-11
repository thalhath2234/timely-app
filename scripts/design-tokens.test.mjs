import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { describe } from "node:test";
import { CSS_COLOR_TOKENS, darkColors, lightColors } from "../packages/contract/src/designTokens.ts";

// The web app declares the shared colour tokens as CSS variables; the phone
// reads packages/contract/src/designTokens.ts. They must stay the same palette.
const css = readFileSync(new URL("../apps/web/app/globals.css", import.meta.url), "utf8");
const block = (selector) => {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} block`);
  return css.slice(start, css.indexOf("}", start));
};
const vars = (text) =>
  Object.fromEntries([...text.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const kebab = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const norm = (value) => value.toLowerCase().replace(/\s+/g, "");

describe("design tokens", () => {
  for (const [name, selector, tokens] of [
    ["light", ":root", lightColors],
    ["dark", ".dark,\n.site", darkColors],
  ]) {
    test(`${name} CSS variables match designTokens.ts`, () => {
      const declared = vars(block(selector));
      for (const key of CSS_COLOR_TOKENS) {
        assert.equal(norm(declared[kebab(key)] ?? "(missing)"), norm(tokens[key]), `--${kebab(key)} (${name})`);
      }
    });
  }
});
