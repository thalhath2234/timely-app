import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createQueryClient } from "../../../apps/mobile/lib/queryClient.ts";
import {
  configureOfflineQueueStorage,
  enqueueMutation,
  queuedMutationCount,
  setOfflineQueueUser,
} from "../../../apps/mobile/lib/offlineQueueCore.ts";

// Framework seam for QA-02. The QueryClient is the app's own configuration
// (apps/mobile/lib/queryClient.ts) and the queue is the app's own policy
// (apps/mobile/lib/offlineQueueCore.ts) with memory in place of the file, so
// this diagnostic can only pass when the production configuration is correct.
// The Android reproduction in README.md exercises the complete app.
//
// Historical output from the audited build is evidence/offline-mutation.json.
// Reruns write to QA_EVIDENCE_FILE, defaulting to the remediation folder.
const requireMobile = createRequire(
  new URL("../../../apps/mobile/package.json", import.meta.url),
);
const reactQueryDir = dirname(
  requireMobile.resolve("@tanstack/react-query/package.json"),
);
const reactQueryEntry = requireMobile("@tanstack/react-query/package.json")
  .exports["."].import.default;
// Same ES module instance as the app configuration imports.
const { MutationObserver, onlineManager } = await import(
  pathToFileURL(join(reactQueryDir, reactQueryEntry)).href
);

let disk = null;
configureOfflineQueueStorage({
  read: () => disk,
  write: (text) => {
    disk = text;
  },
});
setOfflineQueueUser("qa-account");
let persistenceCalls = 0;
const client = createQueryClient();
onlineManager.setOnline(false);
const mutation = new MutationObserver(client, {
  mutationFn: async (data) => {
    persistenceCalls++;
    enqueueMutation("/tasks/qa-task", "PUT", data);
    return { queued: true };
  },
  onMutate: () => undefined,
});
void mutation.mutate({ completedAt: "" }).catch(() => undefined);
await new Promise((resolve) => setTimeout(resolve, 100));
const beforeRestart = {
  paused: mutation.getCurrentResult().isPaused,
  persistenceCalls,
  mutations: client.getMutationCache().getAll().length,
  queued: queuedMutationCount(),
};
// A restarted process has a fresh QueryClient but reads the queue file back.
const restartedClient = createQueryClient();
setOfflineQueueUser(null);
setOfflineQueueUser("qa-account");
const afterRestart = {
  mutations: restartedClient.getMutationCache().getAll().length,
  persistenceCalls,
  queued: queuedMutationCount(),
};
const evidence = { beforeRestart, afterRestart };
console.log(JSON.stringify(evidence, null, 2));
const target =
  process.env.QA_EVIDENCE_FILE ||
  new URL(
    "../2026-10-01-remediation/evidence/offline-mutation.json",
    import.meta.url,
  ).pathname;
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(evidence, null, 2) + "\n");
client.clear();
restartedClient.clear();
onlineManager.setOnline(true);
assert.equal(
  beforeRestart.paused,
  false,
  "Offline mutation paused in memory instead of running",
);
assert.equal(
  beforeRestart.persistenceCalls,
  1,
  "Offline mutation never reached the persistent API queue",
);
assert.equal(
  afterRestart.queued,
  1,
  "Queued change did not survive the restart for its account",
);
