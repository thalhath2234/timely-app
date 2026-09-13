import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");
const webRoot = path.join(import.meta.dirname, "..");
const rendererUrl = process.env.ELECTRON_RENDERER_URL || "http://127.0.0.1:4001";

const child = spawn(electronBinary, ["."], {
  cwd: webRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    ELECTRON_DEV: "1",
    ELECTRON_RENDERER_URL: rendererUrl,
  },
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
