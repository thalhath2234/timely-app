"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Check, Plus, Sparkles, X } from "lucide-react";
import {
  DESCRIBED_MAX_PROMPT,
  SOURCE_LABELS,
  defaultQuery,
  describedSources,
  fitQuery,
  minCardSize,
  type DashboardCard,
} from "@timely/contract/dashboard";
import { DESCRIBE_CHANGES, DESCRIBE_EXAMPLES, readBoardProgram } from "@timely/contract/genuiBoard";
import { todayInZone } from "@timely/contract/workStatus";
import { OverlayFrame, OverlayPanel, OverlayScrim } from "@/app/_components/_ui/motion";
import Button, { buttonClass } from "@/app/_components/_ui/button";
import { Input, Textarea } from "@/app/_components/_ui/field";
import { ListGroup, ListRow } from "@/app/_components/_ui/groupedList";
import { SkeletonLines } from "@/app/_components/_ui/skeleton";
import { readyProviders } from "@/app/_components/chat/modelMenu";
import { describeCardWithAi } from "@/app/utils/api/dashboardCard";
import { useAgentProviders } from "@/app/utils/hooks/agentProviders";
import { Field, Section, Stepper } from "./cardWorkshop";
import { GRID_GAP, ROW_HEIGHT } from "./dashboardGrid";
import DescribedCardView from "./describedCard";
import { useDashboardData } from "./useDashboard";

export interface DescribedResult {
  title: string;
  /** Everything the person asked, one request per line. */
  prompt: string;
  program: string;
  w: number;
  h: number;
}

/**
 * Describe a card: the person says what the card should show, the account's
 * AI provider writes the card's program once (POST /agent/dashboard-card),
 * and the preview draws it from the dashboard's own data. Further words
 * change the built card. The card workshop's frame: words on the left, the
 * card at its real size on the right.
 */
export default function DescribeCardDialog({
  initial,
  onSave,
  onClose,
}: {
  /** A described card being changed; absent starts a new one. */
  initial?: DescribedResult;
  onSave: (result: DescribedResult) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const [words, setWords] = useState("");
  const [program, setProgram] = useState(initial?.program ?? "");
  const [asked, setAsked] = useState<string[]>(() => (initial?.prompt ? initial.prompt.split("\n").filter(Boolean) : []));
  const built = useMemo(() => (program ? readBoardProgram(program) : null), [program]);
  // A name the person typed stays; otherwise the card takes the program's title.
  const [title, setTitle] = useState(() => (initial && initial.title !== readBoardProgram(initial.program)?.title ? initial.title : ""));
  const [size, setSize] = useState({ w: initial?.w ?? 4, h: initial?.h ?? 3 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  // The preview loads what the program reads, even a source no card on the board uses.
  const draft = useMemo<DashboardCard[]>(
    () => (program ? [{ id: "describe", type: "custom", w: 4, h: 3, query: { ...fitQuery(defaultQuery("tasks")), described: { prompt: "", program } } }] : []),
    [program],
  );
  const { data, loading, timeZone } = useDashboardData(draft);
  const now = useMemo(() => new Date(), []);
  const providers = useAgentProviders();
  const aiReady = !providers.data || readyProviders(providers.data).length > 0;
  const sources = program ? describedSources(program) : [];
  const previewLoading = sources.some((source) => loading[source as keyof typeof loading]);

  // The parent passes a new onClose on each render, such as a doc saving while
  // the AI works; only closing the dialog may drop the request.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    box.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      request.current?.abort();
    };
  }, []);

  const build = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setError("");
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const answer = await describeCardWithAi({ prompt, today: todayInZone(timeZone), current: program || undefined }, controller.signal);
      const next = readBoardProgram(answer.program, data);
      if (!next) throw new Error("The AI's answer was not a card. Try again.");
      // The program's size applies when it is new or the words changed it; a size picked here stays otherwise.
      if (!built || next.size.w !== built.size.w || next.size.h !== built.size.h) setSize(next.size);
      setProgram(answer.program);
      setAsked((list) => [...list, prompt]);
      setWords("");
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError(failure instanceof Error ? failure.message : "Could not build the card. Try again.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  };

  const min = minCardSize({ type: "custom", query: { ...fitQuery(defaultQuery("tasks")), described: { prompt: "", program: program || "x" } } });
  const w = Math.max(size.w, min.w);
  const h = Math.max(size.h, min.h);
  const name = title.trim() || built?.title || "";
  const save = () => {
    if (!program) return;
    onSave({ title: name, prompt: asked.join("\n").slice(-DESCRIBED_MAX_PROMPT), program, w, h });
  };

  // The card at its board height, and the width it would get on a 12-column board up to the panel width.
  const previewHeight = h * ROW_HEIGHT + (h - 1) * GRID_GAP;
  const previewWidth = `${Math.min(100, (w / 12) * 100 * 1.6)}%`;
  const tries = program ? DESCRIBE_CHANGES : DESCRIBE_EXAMPLES;

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <OverlayScrim className="z-[60] bg-black/55" onPointerDown={(event) => event.target === event.currentTarget && onClose()} />
      {/* Near the top, so the dialog grows downward as the card is built. */}
      <OverlayFrame className="z-[60] items-start justify-center p-4 pt-[6vh]">
        <OverlayPanel
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="report-dashboard flex max-h-[min(88vh,880px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        >
          <header className="flex items-center gap-3 border-b border-border px-5 py-3">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-base font-semibold text-foreground">
                {initial ? "Change card" : "Describe a card"}
              </h2>
              <p className="text-xs text-muted-foreground">Say what the card should show. The AI builds it once, then your own data keeps it current.</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close">
              <X className="size-4" />
            </button>
          </header>

          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:overflow-hidden">
            <div className="flex flex-col gap-5 px-5 py-4 lg:overflow-y-auto">
              {aiReady ? (
                <Section title={program ? "Change it" : "Your words"}>
                  <form
                    className="flex flex-col gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void build(words);
                    }}
                  >
                    <Textarea
                      ref={box}
                      rows={3}
                      value={words}
                      maxLength={DESCRIBED_MAX_PROMPT}
                      onChange={(event) => setWords(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          void build(words);
                        }
                      }}
                      placeholder={program ? "Show more rows, add a chart by day, only one project…" : "Overdue client work and what's due this week"}
                      aria-label={program ? "Change the card" : "Describe the card"}
                      className="resize-none"
                    />
                    <div className="flex items-center gap-3">
                      <Button type="submit" leading={<Sparkles />} loading={busy} disabled={!words.trim()}>
                        {program ? "Change card" : "Build card"}
                      </Button>
                      <span className="text-xs text-muted-foreground" aria-live="polite">
                        {busy ? "Building your card…" : ""}
                      </span>
                    </div>
                    {error ? <p className="text-sm text-destructive">{error}</p> : null}
                  </form>
                </Section>
              ) : (
                <div>
                  <ListGroup>
                    <ListRow
                      icon={<Sparkles className="size-4 shrink-0 text-muted-foreground" />}
                      label="Describing cards needs an AI provider"
                      meta="Add a key in Settings, or build the card by hand in the card workshop."
                    >
                      <Link href="/settings?tab=agent" className={buttonClass({ size: "sm", variant: "outline" })}>
                        Open Agent keys
                      </Link>
                    </ListRow>
                  </ListGroup>
                </div>
              )}

              {asked.length ? (
                <Section title="What you asked">
                  <ListGroup>
                    {asked.map((entry, index) => (
                      <ListRow key={index} icon={<Check className="size-3.5 shrink-0 text-success" />} label={entry} />
                    ))}
                  </ListGroup>
                </Section>
              ) : null}

              {aiReady ? (
                <Section title={program ? "Try a change" : "Or start from one"}>
                  <ListGroup>
                    {tries.map((entry) => (
                      <ListRow
                        key={entry}
                        icon={<Sparkles className="size-3.5 shrink-0 text-primary" />}
                        label={entry.charAt(0).toUpperCase() + entry.slice(1)}
                        onClick={busy ? undefined : () => void build(entry)}
                      />
                    ))}
                  </ListGroup>
                </Section>
              ) : null}
            </div>

            <div className="flex flex-col gap-4 border-t border-border bg-muted/40 px-5 py-4 lg:overflow-y-auto lg:border-l lg:border-t-0">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
                <Field label="Name">
                  <Input aria-label="Name" value={title} onChange={(event) => setTitle(event.target.value.slice(0, 120))} placeholder={built?.title || "Named when it's built"} />
                </Field>
                <Field label="Size">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Stepper value={w} min={min.w} max={12} onChange={(next) => setSize((current) => ({ ...current, w: next }))} label="Width" />
                    ×
                    <Stepper value={h} min={min.h} max={10} onChange={(next) => setSize((current) => ({ ...current, h: next }))} label="Height" />
                  </div>
                </Field>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Preview</p>
                {program ? (
                  <div
                    role="region"
                    aria-label={`Preview of ${name}`}
                    className="flex flex-col overflow-hidden rounded-xl border border-border bg-card"
                    style={{ height: previewHeight, width: previewWidth, minWidth: 260, maxWidth: "100%" }}
                  >
                    <div className="flex h-9 shrink-0 items-center gap-1.5 px-3">
                      <Sparkles className="size-3.5 text-muted-foreground" />
                      <span className="truncate text-sm font-medium text-foreground">{name}</span>
                    </div>
                    <div className="min-h-0 flex-1 px-3 pb-3">
                      {previewLoading ? <SkeletonLines lines={3} className="p-1" /> : <DescribedCardView program={program} data={data} timeZone={timeZone} now={now} />}
                    </div>
                  </div>
                ) : (
                  <div
                    className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 text-center"
                    style={{ height: previewHeight, width: previewWidth, minWidth: 260, maxWidth: "100%" }}
                  >
                    {busy ? (
                      <SkeletonLines lines={4} className="w-full px-2" />
                    ) : (
                      <>
                        <Sparkles className="size-5 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Your card shows here once it&rsquo;s built.</p>
                      </>
                    )}
                  </div>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  {sources.length
                    ? `Reads your ${listText(sources.map((source) => SOURCE_LABELS[source].replace("Calendar events", "events").toLowerCase()))} each time the dashboard shows. The AI isn't asked again.`
                    : "Built from your tasks, events, projects, docs and sheets. Nothing is changed."}
                </p>
              </div>
            </div>
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
              Cancel
            </button>
            <Button onClick={save} disabled={!program || busy} leading={initial ? <Check /> : <Plus />}>
              {initial ? "Save changes" : "Add to dashboard"}
            </Button>
          </footer>
        </OverlayPanel>
      </OverlayFrame>
    </>,
    document.body,
  );
}

function listText(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
