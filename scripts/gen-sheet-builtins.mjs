// Writes the built-in sheet templates as JSON for the API, so agents can
// create them too. Ids are placeholders the API replaces on every create.
// Run with `make gen-sheet-builtins`; sheet-template-display.test.mjs fails
// when the JSON is out of date.
import { writeFileSync } from "node:fs";
import { builtinSheetSkeleton, BUILTIN_SHEET_TEMPLATES } from "../packages/contract/src/sheetTemplates.ts";

for (const template of BUILTIN_SHEET_TEMPLATES) {
  const name = template.id.replace(/^builtin:/, "");
  const file = new URL(`../apps/api/internal/features/sheet/builtin/${name}.json`, import.meta.url);
  writeFileSync(file, `${JSON.stringify(builtinSheetSkeleton(template.id))}\n`);
  console.log(`wrote ${file.pathname}`);
}
