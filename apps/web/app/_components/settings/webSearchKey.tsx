"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ExternalLink } from "lucide-react";
import Button from "@/app/_components/_ui/button";
import { Input } from "@/app/_components/_ui/field";
import { GroupHint, GroupLabel, ListGroup, ListRow } from "@/app/_components/_ui/groupedList";
import Select from "@/app/_components/_ui/select";
import { webSearchLine } from "@/app/_components/chat/learningView";
import { requestConfirm } from "@/app/_store/confirmStore";
import { useToastStore } from "@/app/_store/toastStore";
import { useRemoveWebKey, useSetWebKey, useWebKeys } from "@/app/utils/hooks/learning";
import { errorText } from "./learnedShared";

/**
 * Settings → Agent → Web search (Q-3.8): without a key, chats on the New
 * engine search with the chat provider's own search; a search key saved
 * here is used instead. Only the backends the server lists are offered,
 * and the key is never shown again (its hint only).
 */
export function WebSearchGroup({ providerName }: { providerName: string }) {
  const keys = useWebKeys();
  const setKey = useSetWebKey();
  const removeKey = useRemoveWebKey();
  const [editing, setEditing] = useState(false);
  const [backend, setBackend] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const available = (keys.data?.backends ?? []).filter((b) => b.available);
  const chosen = backend || keys.data?.active?.backend || available[0]?.id || "";
  const chosenBackend = keys.data?.backends.find((b) => b.id === chosen);
  const line = webSearchLine(keys.data, providerName);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const close = () => {
    setEditing(false);
    setValue("");
    setBackend("");
    setError(null);
  };
  async function onSave(event: FormEvent) {
    event.preventDefault();
    const key = value.trim();
    if (!key || !chosen || setKey.isPending) return;
    setError(null);
    try {
      await setKey.mutateAsync({ backend: chosen, key });
      close();
    } catch (err) {
      setError(errorText(err, "Could not save the key."));
    }
  }
  const onRemove = () =>
    requestConfirm({
      title: "Remove the search key?",
      description: keys.data?.providerCanSearch
        ? `Chats search with ${providerName || "your chat provider"}’s own search again.`
        : `${providerName || "Your chat provider"} can’t search the web, so chats on the New engine can’t search until you add a key again.`,
      confirmLabel: "Remove",
      pendingLabel: "Removing…",
      onConfirm: async () => {
        try {
          await removeKey.mutateAsync();
          close();
        } catch (err) {
          useToastStore.getState().show(errorText(err, "Could not remove the key."));
        }
      },
    });

  return (
    <section data-testid="web-search-key">
      <GroupLabel>Web search</GroupLabel>
      <ListGroup>
        <ListRow
          label={line.label}
          meta={
            keys.isPending ? (
              "Checking…"
            ) : keys.error ? (
              <span className="text-destructive">{errorText(keys.error, "Could not load web search.")}</span>
            ) : line.tone === "warn" ? (
              <span className="text-warning-text">{line.meta}</span>
            ) : (
              <span className="tabular-nums">{line.meta}</span>
            )
          }
        >
          {keys.error ? (
            <Button variant="ghost" size="sm" onClick={() => void keys.refetch()}>
              Retry
            </Button>
          ) : keys.data && !editing && available.length > 0 ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                {line.action}
              </Button>
              {keys.data.active ? (
                <Button variant="ghost" size="sm" onClick={onRemove} disabled={removeKey.isPending}>
                  Remove
                </Button>
              ) : null}
            </>
          ) : null}
        </ListRow>
        {editing ? (
          <form onSubmit={onSave} className="flex flex-col gap-2 px-3.5 py-2.5">
            {available.length > 1 && (
              <Select
                aria-label="Search service"
                value={chosen}
                onChange={setBackend}
                options={available.map((b) => ({ value: b.id, label: b.label }))}
              />
            )}
            <div className="flex items-center gap-2">
              <Input
                ref={inputRef}
                type="password"
                autoComplete="off"
                spellCheck={false}
                aria-label={`${chosenBackend?.label ?? "Search"} key`}
                aria-invalid={error ? true : undefined}
                placeholder={`Paste your ${chosenBackend?.label ?? "search"} key`}
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  if (error) setError(null);
                }}
                disabled={setKey.isPending}
              />
              <Button type="submit" size="sm" loading={setKey.isPending} disabled={!value.trim() || !chosen}>
                Save
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
            {chosenBackend?.keyUrl ? (
              <a
                href={chosenBackend.keyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                Get a {chosenBackend.label} key
                <ExternalLink aria-hidden className="size-3" />
              </a>
            ) : null}
          </form>
        ) : null}
      </ListGroup>
      <GroupHint>
        For chats on the New engine. Without a key they use your chat provider&apos;s own search; a key here is used
        instead. Timely never shows the key again.
      </GroupHint>
    </section>
  );
}
