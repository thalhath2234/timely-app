// Writes the reply-card instructions for the API from the shared component
// list, so the agent's prompt always matches what the apps can draw. Run with
// `make gen-genui-prompt`; genui.test.mjs fails when the file is out of date.
import { writeFileSync } from "node:fs";
import { genuiPrompt } from "../packages/contract/src/genui.ts";

const file = new URL("../apps/api/internal/features/chat/genui_prompt.txt", import.meta.url);
writeFileSync(file, `${genuiPrompt()}\n`);
console.log(`wrote ${file.pathname}`);
