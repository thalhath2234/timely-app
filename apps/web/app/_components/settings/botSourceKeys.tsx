"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { ExternalLink } from "lucide-react";
import Button from "@/app/_components/_ui/button";
import { Input } from "@/app/_components/_ui/field";
import { GroupHint, GroupLabel, ListGroup, ListRow } from "@/app/_components/_ui/groupedList";
import { requestConfirm } from "@/app/_store/confirmStore";
import { useToastStore } from "@/app/_store/toastStore";
import { useRemoveSourceKey, useSetSourceKey, useSourceKeys } from "@/app/utils/hooks/bots";
import type { SourceKeyView } from "@timely/contract/bots";

/** The anchor the bots page links to (`BOT_KEYS_HREF`). */
const ANCHOR = "bot-keys";
const SOURCE = "finnhub";
const REGISTER_URL = "https://finnhub.io/register";

function keyMeta(view: SourceKeyView | undefined) {
  if (!view?.keySet) return "Not set";
  if (view.state === "refused") return "Finnhub refused it. Replace it.";
  return view.keyHint ? `Saved · ${view.keyHint}` : "Saved";
}

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function atAnchor() {
  return window.location.hash === `#${ANCHOR}`;
}

function errorText(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Settings › Agent: the free Finnhub key stock bots read US prices with.
 * Write-only: the server checks the key with Finnhub before saving it and
 * only ever answers with its last four characters.
 */
export function BotSourceKeysGroup() {
  const keys = useSourceKeys();
  const setKey = useSetSourceKey();
  const removeKey = useRemoveSourceKey();
  const view = keys.data?.find((row) => row.source === SOURCE);
  // Coming from a bot's "Add a free Finnhub key" link (`#bot-keys`), the
  // form starts open when there is no usable key; null means not chosen yet.
  // On a client navigation this can first render before the router writes the
  // new URL, so the hash is read through a store, which React checks again
  // after commit, and latched once seen.
  const hashIsAnchor = useSyncExternalStore(subscribeHash, atAnchor, () => false);
  const [fromLink, setFromLink] = useState(false);
  if (hashIsAnchor && !fromLink) setFromLink(true);
  const [chosen, setEditing] = useState<boolean | null>(null);
  const needsKey = !!keys.data && (!view?.keySet || view.state === "refused");
  const editing = chosen ?? (fromLink && needsKey);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const loaded = !!keys.data;

  useEffect(() => {
    if (fromLink && loaded) sectionRef.current?.scrollIntoView({ block: "start" });
  }, [fromLink, loaded]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const close = () => {
    setEditing(false);
    setValue("");
    setError(null);
  };

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    const key = value.trim();
    if (!key || setKey.isPending) return;
    setError(null);
    try {
      await setKey.mutateAsync({ source: SOURCE, key });
      close();
    } catch (err) {
      setError(errorText(err, "Could not save the key."));
    }
  };

  const onRemove = () =>
    requestConfirm({
      title: "Remove your Finnhub key?",
      description:
        "Stock bots stop reading prices until you add a key again. Each check without one counts as a strike.",
      confirmLabel: "Remove",
      pendingLabel: "Removing…",
      onConfirm: async () => {
        try {
          await removeKey.mutateAsync(SOURCE);
          close();
        } catch (err) {
          useToastStore.getState().show(errorText(err, "Could not remove the key."));
        }
      },
    });

  const refused = view?.keySet && view.state === "refused";

  return (
    <section id={ANCHOR} ref={sectionRef} data-testid="bot-source-keys" className="scroll-mt-4">
      <GroupLabel>Stock prices for bots</GroupLabel>
      <ListGroup>
        <ListRow
          label="Finnhub key"
          meta={
            keys.isPending ? (
              "Loading…"
            ) : keys.error ? (
              <span className="text-destructive">{errorText(keys.error, "Could not load the key.")}</span>
            ) : refused ? (
              <span className="text-destructive">{keyMeta(view)}</span>
            ) : (
              <span className="tabular-nums">{keyMeta(view)}</span>
            )
          }
        >
          {keys.error ? (
            <Button variant="ghost" size="sm" onClick={() => void keys.refetch()}>
              Retry
            </Button>
          ) : keys.data && !editing ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                {view?.keySet ? "Replace" : "Add key"}
              </Button>
              {view?.keySet ? (
                <Button variant="ghost" size="sm" onClick={onRemove} disabled={removeKey.isPending}>
                  Remove
                </Button>
              ) : null}
            </>
          ) : null}
        </ListRow>
        {editing ? (
          <form onSubmit={onSave} className="flex flex-col gap-2 px-3.5 py-2.5">
            <div className="flex items-center gap-2">
              <Input
                ref={inputRef}
                type="password"
                autoComplete="off"
                spellCheck={false}
                aria-label="Finnhub key"
                aria-invalid={error ? true : undefined}
                placeholder="Paste your Finnhub key"
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  if (error) setError(null);
                }}
                disabled={setKey.isPending}
              />
              <Button type="submit" size="sm" loading={setKey.isPending} disabled={!value.trim()}>
                {setKey.isPending ? "Checking…" : "Save"}
              </Button>
              <Button variant="ghost" size="sm" onClick={close} disabled={setKey.isPending}>
                Cancel
              </Button>
            </div>
            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
            <a
              href={REGISTER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              Get a free key
              <ExternalLink aria-hidden className="size-3" />
            </a>
          </form>
        ) : null}
      </ListGroup>
      <GroupHint>
        Free. Stock bots need it to read US prices from Finnhub. Crypto bots don&apos;t. Timely never shows the key
        again.
      </GroupHint>
    </section>
  );
}
