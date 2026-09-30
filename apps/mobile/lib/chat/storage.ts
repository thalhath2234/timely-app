import * as FS from "expo-file-system/legacy";
import type {
  AssistantDraft,
  Chat,
  ReceiptDraft,
  ReceiptDestination,
} from "./types";

export type ReceiptEdit = {
  signature: string;
  draft: ReceiptDraft;
  destination?: ReceiptDestination;
  reviewed: boolean;
  dirty: boolean;
};
export type AssistantCache = {
  receiptEdits: Record<string, ReceiptEdit>;
  draft: AssistantDraft | null;
  chats: Chat[];
  conversations: Record<string, Chat>;
  hintDismissed: boolean;
};
const empty = (): AssistantCache => ({
  receiptEdits: {},
  draft: null,
  chats: [],
  conversations: {},
  hintDismissed: false,
});
const directory = (uid: string) =>
  `${FS.documentDirectory}assistant-${encodeURIComponent(uid)}/`;
let writes: Promise<unknown> = Promise.resolve();
export async function loadAssistantCache(uid: string): Promise<AssistantCache> {
  try {
    const parsed = JSON.parse(
      await FS.readAsStringAsync(`${directory(uid)}state.json`),
    );
    return { ...empty(), ...parsed };
  } catch {
    return empty();
  }
}
export function saveAssistantCache(uid: string, state: AssistantCache) {
  const serialized = JSON.stringify(state);
  writes = writes
    .catch(() => undefined)
    .then(async () => {
      await FS.makeDirectoryAsync(directory(uid), { intermediates: true });
      await FS.writeAsStringAsync(`${directory(uid)}state.json`, serialized);
    });
  return writes;
}
export function clearAssistantCache(uid: string) {
  writes = writes
    .catch(() => undefined)
    .then(() => FS.deleteAsync(directory(uid), { idempotent: true }));
  return writes;
}
export async function retainImage(uid: string, uri: string, name: string) {
  const dest = `${directory(uid)}${Date.now()}-${Math.random().toString(36).slice(2)}-${name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
  await FS.makeDirectoryAsync(directory(uid), { intermediates: true });
  await FS.copyAsync({ from: uri, to: dest });
  return dest;
}
export async function removeLocalImage(uri: string) {
  if (uri.startsWith(FS.documentDirectory + "assistant-"))
    await FS.deleteAsync(uri, { idempotent: true });
}
