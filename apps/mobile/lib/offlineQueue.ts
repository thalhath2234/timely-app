import { configureOfflineQueueStorage } from "./offlineQueueCore";
import { documentTextFile } from "./textFile";

export type { QueuedMutation, ReplayOutcome } from "./offlineQueueCore";
export {
  enqueueMutation,
  getOfflineQueueUser,
  queuedMutationCount,
  queuedMutationsForActiveUser,
  removeQueuedMutation,
  replayQueuedMutations,
  setOfflineQueueUser,
  subscribeQueuedMutations,
} from "./offlineQueueCore";

// The queue lives in the app's document directory so it survives the process
// being killed; the account id on each entry keeps it scoped after sign-out.
configureOfflineQueueStorage(documentTextFile("timely-offline-mutations.json"));
