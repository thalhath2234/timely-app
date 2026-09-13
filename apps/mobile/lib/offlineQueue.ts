import { File, Paths } from "expo-file-system";

export type QueuedMutation = {
  id: string;
  userId: string;
  path: string;
  method: string;
  body?: unknown;
  createdAt: string;
};

const queueFile = new File(Paths.document, "timely-offline-mutations.json");
let activeUserId = "";
const listeners = new Set<(count: number) => void>();

function readQueue(): QueuedMutation[] {
  try {
    if (!queueFile.exists) return [];
    const parsed = JSON.parse(queueFile.textSync()) as QueuedMutation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedMutation[]) {
  queueFile.write(JSON.stringify(items));
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

export function getOfflineQueueUser() { return activeUserId; }

export function queuedMutationCount() {
  return readQueue().filter((item) => item.userId === activeUserId).length;
}

export function subscribeQueuedMutations(listener: (count: number) => void) {
  listeners.add(listener);
  listener(queuedMutationCount());
  return () => { listeners.delete(listener); };
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
