import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

// Framework seam matching apps/mobile/app/_layout.tsx and useSaveTask.
// The Android reproduction in README.md exercises the complete app.
const requireMobile = createRequire(
  new URL("../../../apps/mobile/package.json", import.meta.url),
);
const { QueryClient, MutationObserver, onlineManager } = requireMobile(
  "@tanstack/react-query",
);
const makeClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false },
    },
  });
let persistenceCalls = 0;
const client = makeClient();
onlineManager.setOnline(false);
const mutation = new MutationObserver(client, {
  mutationFn: async () => {
    persistenceCalls++;
  },
  onMutate: () => undefined,
});
void mutation.mutate({ completed: false }).catch(() => undefined);
await new Promise((resolve) => setTimeout(resolve, 100));
const beforeRestart = {
  paused: mutation.getCurrentResult().isPaused,
  persistenceCalls,
  mutations: client.getMutationCache().getAll().length,
};
// A new QueryClient has no mutation hydration in the current root layout.
const restartedClient = makeClient();
const afterRestart = {
  mutations: restartedClient.getMutationCache().getAll().length,
  persistenceCalls,
};
const evidence = { beforeRestart, afterRestart };
console.log(JSON.stringify(evidence, null, 2));
writeFileSync(
  new URL("evidence/offline-mutation.json", import.meta.url),
  JSON.stringify(evidence, null, 2) + "\n",
);
client.clear();
restartedClient.clear();
onlineManager.setOnline(true);
assert.equal(
  beforeRestart.persistenceCalls,
  1,
  "Offline mutation never reached the persistent API queue",
);
