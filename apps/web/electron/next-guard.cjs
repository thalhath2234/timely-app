// Preloaded into the desktop app's bundled Next.js server (`--require`, see
// electron/supervisor/next.ts); electron/stage-next.mjs copies it next to the
// standalone output as next-server/timely-guard.cjs. Plain CommonJS: it runs
// in Electron's Node (ELECTRON_RUN_AS_NODE) before server.js, untranspiled.
//
// 1. Lifeline (TIMELY_LIFELINE=stdin): the app holds the write end of a pipe
//    on our stdin and never writes to it. When the app exits for any reason
//    (quit, crash, OOM kill, a lost Wayland/X session) the OS closes it and we
//    read EOF, so the server exits instead of living on as an orphan.
// 2. Memory ceiling (TIMELY_WEB_RSS_LIMIT_MB): past it the server exits with
//    EXIT_OVER_MEMORY and the app's supervisor starts a fresh one. The V8 heap
//    is capped separately with --max-old-space-size; this also counts memory
//    outside the heap (buffers, native code).
"use strict";

const EXIT_OVER_MEMORY = 75;

if (process.env.TIMELY_LIFELINE === "stdin" && process.stdin) {
  const exit = () => process.exit(0);
  process.stdin.on("end", exit);
  process.stdin.on("close", exit);
  process.stdin.on("error", exit);
  process.stdin.resume();
}

const limitMb = Number(process.env.TIMELY_WEB_RSS_LIMIT_MB);
if (Number.isFinite(limitMb) && limitMb > 0) {
  const everyMs = Number(process.env.TIMELY_WEB_RSS_CHECK_MS) || 30_000;
  const timer = setInterval(() => {
    const rssMb = Math.round(process.memoryUsage.rss() / (1024 * 1024));
    if (rssMb <= limitMb) return;
    try {
      process.stderr.write(`timely-guard: web server uses ${rssMb} MB (limit ${limitMb} MB); exiting so the app starts a fresh one\n`);
    } catch {
      // The log pipe is gone; exit anyway.
    }
    process.exit(EXIT_OVER_MEMORY);
  }, everyMs);
  timer.unref();
}
