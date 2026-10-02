import { File, Paths } from "expo-file-system";
import { configureOfflineQueueStorage } from "./offlineQueueCore";

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
const queueFile = new File(Paths.document, "timely-offline-mutations.json");

configureOfflineQueueStorage({
  read: () => (queueFile.exists ? queueFile.textSync() : null),
  write: (text) => queueFile.write(text),
});
