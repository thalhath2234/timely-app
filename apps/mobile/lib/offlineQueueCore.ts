// Durable queue for safe offline mutations. This module holds the whole queue
// policy (account scoping, ordering, replay, drop-on-rejection) and depends on
// nothing native, so the Node regression test in scripts/mobile-offline-queue
// exercises exactly what the app runs. offlineQueue.ts binds it to a file in
// the app's document directory.

export type QueuedMutation = {
  id: string;
  userId: string;
  path: string;
  method: string;
  body?: unknown;
  createdAt: string;
};

export type QueueStorage = {
  read(): string | null;
  write(text: string): void;
};

export type ReplayOutcome = { sent: number; dropped: number; remaining: number };

let storage: QueueStorage = {
  read: () => null,
  write: () => undefined,
};
let activeUserId = "";
const listeners = new Set<(count: number) => void>();

export function configureOfflineQueueStorage(next: QueueStorage) {
  storage = next;
  notify();
}

function readQueue(): QueuedMutation[] {
  try {
    const text = storage.read();
    if (!text) return [];
    const parsed = JSON.parse(text) as QueuedMutation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedMutation[]) {
  storage.write(JSON.stringify(items));
  notify(items);
}

function notify(items = readQueue()) {
  const count = items.filter((item) => item.userId === activeUserId).length;
  for (const listener of listeners) listener(count);
}

export function setOfflineQueueUser(userId: string | null | undefined) {
  activeUserId = userId ?? "";
  notify();
}

export function getOfflineQueueUser() {
  return activeUserId;
}

export function queuedMutationCount() {
  return readQueue().filter((item) => item.userId === activeUserId).length;
}

export function subscribeQueuedMutations(listener: (count: number) => void) {
  listeners.add(listener);
  listener(queuedMutationCount());
  return () => {
    listeners.delete(listener);
  };
}

export function enqueueMutation(path: string, method: string, body: unknown) {
  if (!activeUserId) throw new Error("Cannot queue a change before the account is loaded.");
  const items = readQueue();
  items.push({
    id: `offline_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    userId: activeUserId,
    path,
    method,
    body,
    createdAt: new Date().toISOString(),
  });
  writeQueue(items);
}

export function queuedMutationsForActiveUser() {
  return readQueue().filter((item) => item.userId === activeUserId);
}

export function removeQueuedMutation(id: string) {
  writeQueue(readQueue().filter((item) => item.id !== id));
}

/**
 * Replays the active account's queued mutations in order. A mutation the server
 * rejects outright (`shouldDrop`) is discarded so a stale change cannot block
 * the queue forever; any other failure stops the replay and keeps the rest for
 * the next attempt.
 */
export async function replayQueuedMutations(
  send: (item: QueuedMutation) => Promise<unknown>,
  shouldDrop: (error: unknown) => boolean,
): Promise<ReplayOutcome> {
  const outcome: ReplayOutcome = { sent: 0, dropped: 0, remaining: 0 };
  for (const item of queuedMutationsForActiveUser()) {
    try {
      await send(item);
      removeQueuedMutation(item.id);
      outcome.sent += 1;
    } catch (error) {
      if (shouldDrop(error)) {
        removeQueuedMutation(item.id);
        outcome.dropped += 1;
        continue;
      }
      break;
    }
  }
  outcome.remaining = queuedMutationCount();
  return outcome;
}
