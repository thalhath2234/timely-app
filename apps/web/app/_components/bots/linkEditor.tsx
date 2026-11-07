"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { BOT_LIMITS, type LinkInput } from "@timely/contract/bots";
import Button from "@/app/_components/_ui/button";
import {
  GroupHint,
  GroupLabel,
  ListGroup,
  ListRow,
} from "@/app/_components/_ui/groupedList";
import Select from "@/app/_components/_ui/select";
import { requestConfirm } from "@/app/_store/confirmStore";
import { RowInput } from "./editPill";

/** A bot a link can pass to. */
export type LinkTarget = { id: string; name: string };

/** "2TB NVMe, 4TB" as the filter words it holds. */
const wordsOf = (text: string) =>
  text
    .split(",")
    .map((w) => w.replace(/\s+/g, " ").trim())
    .filter(Boolean);

/**
 * One Pass to link, edited in place of the editor's groups (as a watch is):
 * the bot it passes to and the words a find must mention. Save hands the
 * link back; the editor saves the bot's whole list. An existing link can be
 * removed after a confirm.
 */
export function LinkEditor({
  link: initial,
  isNew,
  targets,
  targetName,
  onSave,
  onRemove,
  onBack,
  onDirty,
}: {
  link: LinkInput;
  isNew: boolean;
  /** The bots it may pass to: watch bots, not this one, not one it already passes to. */
  targets: LinkTarget[];
  /** The saved target's name, shown even when it is no longer listed. */
  targetName?: string;
  onSave: (link: LinkInput) => void;
  onRemove?: () => void;
  onBack: () => void;
  /** Hears whether the link differs from what it opened with; false once it closes. */
  onDirty?: (dirty: boolean) => void;
}) {
  const [botId, setBotId] = useState(initial.botId);
  const [text, setText] = useState(initial.filter.join(", "));
  const words = wordsOf(text);
  const dirty =
    botId !== initial.botId ||
    JSON.stringify(words) !== JSON.stringify(initial.filter);
  const dirtyRef = useRef(onDirty);
  useEffect(() => {
    dirtyRef.current = onDirty;
  });
  useEffect(() => {
    dirtyRef.current?.(dirty);
  }, [dirty]);
  useEffect(() => () => dirtyRef.current?.(false), []);
  // It opens from Works with, far down the column: bring its top into view.
  const topRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    topRef.current?.scrollIntoView({ block: "nearest" });
  }, []);

  const options = targets.map((t) => ({ value: t.id, label: t.name }));
  if (botId && !options.some((o) => o.value === botId)) {
    options.unshift({ value: botId, label: targetName ?? "A deleted bot" });
  }
  const name = options.find((o) => o.value === botId)?.label;
  const problem = !botId
    ? targets.length
      ? "Pick the bot that checks what this one finds"
      : "Make another bot that watches something first"
    : words.length > BOT_LIMITS.maxFilterWords
      ? `Up to ${BOT_LIMITS.maxFilterWords} filter words`
      : null;

  return (
    <div className="flex flex-col gap-5">
      <div ref={topRef} className="flex scroll-mt-5 items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          leading={<ArrowLeft />}
          onClick={onBack}
        >
          Works with
        </Button>
        <span className="text-[13px] font-semibold text-foreground">
          {isNew ? "Pass to a bot" : "Edit pass"}
        </span>
      </div>

      <section>
        <GroupLabel>Passes to</GroupLabel>
        <ListGroup>
          <ListRow
            label="Bot"
            meta="It checks each find under its own rules and limits"
          >
            <Select
              variant="row"
              aria-label="Bot"
              placeholder="Pick a bot"
              searchable={options.length > 8}
              value={botId}
              options={options}
              menuMinWidth={220}
              onChange={setBotId}
            />
          </ListRow>
          <ListRow
            label="Only when it mentions"
            meta="Words, with commas between"
          >
            <RowInput
              aria-label="Only when it mentions"
              value={text}
              placeholder="e.g. 2TB NVMe"
              invalid={words.length > BOT_LIMITS.maxFilterWords}
              onChange={setText}
            />
          </ListRow>
        </ListGroup>
        <GroupHint>
          Leave empty to pass on everything. Separate words with commas.
        </GroupHint>
        <GroupHint>
          {name
            ? `${name} checks ${words.length ? `finds that mention ${words.join(" or ")}` : "everything this bot finds"} before you are told. `
            : ""}
          Up to {BOT_LIMITS.linkPerDay} items a day; more wait for the next
          brief.
        </GroupHint>
      </section>

      {!isNew ? (
        <section>
          <ListGroup>
            <ListRow
              label="Remove"
              tone="danger"
              icon={
                <Trash2
                  aria-hidden
                  className="size-4 shrink-0 text-destructive"
                />
              }
              onClick={() =>
                requestConfirm({
                  title: `Stop passing to ${targetName ?? name ?? "this bot"}?`,
                  description:
                    "What this bot finds comes to you again, under its own rules.",
                  confirmLabel: "Remove",
                  onConfirm: () => onRemove?.(),
                })
              }
            />
          </ListGroup>
        </section>
      ) : null}

      <div className="flex items-center gap-2 border-t border-border pt-4">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {problem ?? "This bot stays quiet about what it passes on."}
        </p>
        <Button variant="outline" onClick={onBack}>
          Cancel
        </Button>
        <Button
          disabled={!!problem}
          onClick={() =>
            // Another bot makes a new link: the old one's id and switch stay with it.
            onSave(
              botId === initial.botId
                ? { ...initial, botId, filter: words }
                : { botId, filter: words },
            )
          }
        >
          {isNew ? "Add" : "Save"}
        </Button>
      </div>
    </div>
  );
}
