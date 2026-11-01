/**
 * The edits an autosave has yet to write, one entry per edit, for the web and
 * phone useAutosave hooks. Queued edits go out merged in one request. A
 * request that fails on the way (offline, a server error) keeps its edits for
 * the next try. A request the server refuses (a 4xx such as "blocking task
 * not found") can never succeed as sent, so its edits are not kept: when it
 * held several edits they are sent again one at a time, so only the refused
 * ones are dropped and the rest still save. Without this, one refused field
 * rode along in every later save and nothing in the panel saved again.
 */

/** What became of one edit: written, refused by the server, or not sent yet (it stays queued). */
export type AutosaveOutcome = "saved" | "rejected" | "failed";

/** The 4xx answers that refuse the change itself, so sending it again cannot work. */
const REFUSALS = new Set([400, 404, 409, 413, 422]);

/** Whether an error is the server refusing the change (it carries a `status`, such as 400). */
export function isRejection(error: unknown): boolean {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  return typeof status === "number" && REFUSALS.has(status);
}

export type AutosaveResult = {
  /** Everything queued was written. */
  ok: boolean;
  /** A request failed on the way; its edits are still queued for a retry. */
  error?: unknown;
  /** The last refusal; the refused edits were dropped. */
  rejected?: unknown;
};

type Entry<T> = {
  patch: Partial<T>;
  /** The fields it sets, so typing in one field stays one edit. */
  fields: string;
  listeners: ((outcome: AutosaveOutcome) => void)[];
};

export type AutosaveQueue<T extends object> = {
  /** Queues an edit. `onSettled` hears what became of it, once. */
  add(patch: Partial<T>, onSettled?: (outcome: AutosaveOutcome) => void): void;
  /** Whether any edit waits to be written. */
  pending(): boolean;
  /** Writes everything queued, including edits added while it runs. Run one at a time. */
  send(save: (patch: Partial<T>) => Promise<unknown>, onRejected?: (error: unknown, patch: Partial<T>) => void): Promise<AutosaveResult>;
};

export function createAutosaveQueue<T extends object>(): AutosaveQueue<T> {
  let entries: Entry<T>[] = [];

  const settle = (list: Entry<T>[], outcome: AutosaveOutcome) => {
    for (const entry of list) {
      const listeners = entry.listeners;
      entry.listeners = [];
      for (const listener of listeners) listener(outcome);
    }
  };
  const merged = (list: Entry<T>[]) => Object.assign({}, ...list.map((entry) => entry.patch)) as Partial<T>;

  return {
    add(patch, onSettled) {
      const fields = Object.keys(patch).sort().join(",");
      const last = entries[entries.length - 1];
      if (last && last.fields === fields) {
        last.patch = { ...last.patch, ...patch };
        if (onSettled) last.listeners.push(onSettled);
        return;
      }
      entries.push({ patch: { ...patch }, fields, listeners: onSettled ? [onSettled] : [] });
    },
    pending: () => entries.length > 0,
    async send(save, onRejected) {
      let refusal: { error: unknown } | undefined;
      const refuse = (entry: Entry<T>, error: unknown) => {
        refusal = { error };
        onRejected?.(error, entry.patch);
        settle([entry], "rejected");
      };
      // Edits queued while a request runs go out in the next pass.
      while (entries.length > 0) {
        const batch = entries;
        entries = [];
        try {
          await save(merged(batch));
          settle(batch, "saved");
          continue;
        } catch (error) {
          if (!isRejection(error)) {
            entries = [...batch, ...entries];
            settle(batch, "failed");
            return { ok: false, error };
          }
          if (batch.length === 1) {
            refuse(batch[0], error);
            continue;
          }
        }
        // Several edits were refused together: find the refused ones.
        for (let i = 0; i < batch.length; i += 1) {
          try {
            await save(batch[i].patch);
            settle([batch[i]], "saved");
          } catch (error) {
            if (!isRejection(error)) {
              const left = batch.slice(i);
              entries = [...left, ...entries];
              settle(left, "failed");
              return { ok: false, error };
            }
            refuse(batch[i], error);
          }
        }
      }
      return refusal ? { ok: false, rejected: refusal.error } : { ok: true };
    },
  };
}

/** The note for a change the server refused: that it was not saved, then the server's reason. */
export function refusalMessage(error: unknown): string {
  const reason = error instanceof Error ? error.message.trim().replace(/\.$/, "") : "";
  return reason ? `Could not save that change. ${reason.charAt(0).toUpperCase()}${reason.slice(1)}.` : "Could not save that change.";
}
