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
//    EXIT_OVER_MEMORY and the app's supervisor starts a fresh one. It also
//    exits when the V8 heap (capped with --max-old-space-size) stays nearly
//    full, before V8 would abort with "Reached heap limit" after thrashing in
//    garbage collection. RSS also counts memory outside the heap.
//    Before exiting it stops taking new connections and lets the requests
//    already running finish (a save on its way to the API), for up to
//    DRAIN_MS. The app retries what arrives in the gap (app/utils/api/retry.ts).
//    Event streams (a doc being watched) are not waited for; the browser
//    reconnects them.
//
// Worker threads load --require modules too; they have no stdin of their own
// and are not the server, so the guard runs only on the main thread.
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- a plain CommonJS preload, not bundled */

const diagnostics = require("node:diagnostics_channel");
const { isMainThread } = require("node:worker_threads");
const v8 = require("node:v8");

const EXIT_OVER_MEMORY = 75;
const HEAP_FULL = 0.85;
const DRAIN_MS = 10_000;

if (isMainThread && process.env.TIMELY_LIFELINE === "stdin" && process.stdin) {
  const exit = () => process.exit(0);
  process.stdin.on("end", exit);
  process.stdin.on("close", exit);
  process.stdin.on("error", exit);
  process.stdin.resume();
}

const servers = new Set();
let inFlight = 0;
let stopping = false;

function trackRequests() {
  diagnostics.subscribe("http.server.request.start", ({ request, response, server }) => {
    if (server) servers.add(server);
    if (String(request.headers.accept ?? "").includes("text/event-stream")) return;
    inFlight += 1;
    response.once("close", () => (inFlight -= 1));
  });
}

function overMemory(reason) {
  if (stopping) return;
  stopping = true;
  try {
    process.stderr.write(`timely-guard: ${reason}; exiting so the app starts a fresh one\n`);
  } catch {
    // The log pipe is gone; exit anyway.
  }
  for (const server of servers) {
    try {
      server.close();
    } catch {
      // Already closed.
    }
  }
  const deadline = Date.now() + DRAIN_MS;
  const exitWhenDrained = () => {
    if (inFlight <= 0 || Date.now() >= deadline) process.exit(EXIT_OVER_MEMORY);
    setTimeout(exitWhenDrained, 100);
  };
  exitWhenDrained();
}

function oldGenerationMb() {
  let bytes = 0;
  for (const space of v8.getHeapSpaceStatistics()) {
    if (space.space_name !== "new_space" && space.space_name !== "new_large_object_space") bytes += space.space_used_size;
  }
  return Math.round(bytes / (1024 * 1024));
}

const limitMb = Number(process.env.TIMELY_WEB_RSS_LIMIT_MB);
const heapLimitMb = Number(process.env.TIMELY_WEB_HEAP_LIMIT_MB) || 0;
if (isMainThread && Number.isFinite(limitMb) && limitMb > 0) {
  trackRequests();
  const everyMs = Number(process.env.TIMELY_WEB_RSS_CHECK_MS) || 30_000;
  let heapFullChecks = 0;
  const timer = setInterval(() => {
    const rssMb = Math.round(process.memoryUsage.rss() / (1024 * 1024));
    if (rssMb > limitMb) overMemory(`web server uses ${rssMb} MB (limit ${limitMb} MB)`);
    // Garbage collection empties a full heap that is only garbage, so two
    // full readings in a row mean the memory is really held. The cap
    // (--max-old-space-size, passed in as TIMELY_WEB_HEAP_LIMIT_MB) applies
    // to everything outside the young generation.
    if (heapLimitMb > 0) {
      const oldMb = oldGenerationMb();
      heapFullChecks = oldMb > heapLimitMb * HEAP_FULL ? heapFullChecks + 1 : 0;
      if (heapFullChecks >= 2) overMemory(`web server heap is full (${oldMb} of ${heapLimitMb} MB)`);
    }
  }, everyMs);
  timer.unref();
}
