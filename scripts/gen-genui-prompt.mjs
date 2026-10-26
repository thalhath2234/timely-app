// Writes the agent's OpenUI instructions for the API from the shared
// component lists, so the prompts always match what the apps can draw: reply
// cards for chat, described cards for the dashboard. Run with
// `make gen-genui-prompt`; genui.test.mjs fails when a file is out of date.
import { writeFileSync } from "node:fs";
import { genuiPrompt } from "../packages/contract/src/genui.ts";
import { boardPrompt } from "../packages/contract/src/genuiBoard.ts";

const files = [
  ["../apps/api/internal/features/chat/genui_prompt.txt", genuiPrompt()],
  ["../apps/api/internal/features/provider/board_prompt.txt", boardPrompt()],
];
for (const [path, text] of files) {
  const file = new URL(path, import.meta.url);
  writeFileSync(file, `${text}\n`);
  console.log(`wrote ${file.pathname}`);
}
