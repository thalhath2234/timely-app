"use client";
import { useEffect, useId, useState } from "react";
import {
  Ban,
  Check,
  Clock,
  MessageCircleQuestionMark,
  SkipForward,
  TimerOff,
} from "lucide-react";
import {
  QUESTION_CARD_TITLES,
  questionSecondsLeft,
  questionTimeLeft,
  type AnsweredQuestion,
  type ChatQuestion,
  type QuestionAnswer,
  type QuestionCardState,
  type QuestionItem,
} from "@timely/contract/agentChat";
import Button from "@/app/_components/_ui/button";
import { Input, Textarea } from "@/app/_components/_ui/field";
import { cn } from "@/app/utils/cn";
import { timeOfDay } from "./chatMeta";
import {
  choiceLabel,
  closedCard,
  draftAnswers,
  isOpen,
  pickChoice,
  pickOf,
  sendProblem,
  toggleOther,
  typeOther,
  type QuestionDraft,
} from "./questionDraft";

/**
 * The question card (phase 4, Q-4.3): the agent asks one to five questions
 * and its run waits. Built like the learning card: a header tile, one block
 * per question under a hairline, then Skip and Send answer. The questions
 * come from the model, which may have read outside pages, so they show as
 * plain text: no links, no formatting.
 */

/** Re-renders every second in the last minute, else every 15 seconds. */
function useSecondsLeft(question: ChatQuestion) {
  const [now, setNow] = useState(() => Date.now());
  const left = questionSecondsLeft(question, now);
  useEffect(() => {
    if (left === null || left <= 0) return;
    const id = setTimeout(() => setNow(Date.now()), left <= 60 ? 1000 : 15000);
    return () => clearTimeout(id);
  }, [left, now]);
  return { left, label: questionTimeLeft(question, now) };
}

const rowClass =
  "relative flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-1.5 text-[13px] leading-[18px] transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/40";

/** The radio or checkbox drawn for a row; the real input sits under it for keyboards and screen readers. */
function Mark({ multi, on }: { multi: boolean; on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4 shrink-0 items-center justify-center border transition-colors",
        multi ? "rounded-[5px]" : "rounded-full",
        on
          ? "border-primary bg-primary text-primary-foreground"
          : "border-muted-foreground/50 bg-card",
      )}
    >
      {on &&
        (multi ? (
          <Check className="size-3" strokeWidth={3} />
        ) : (
          <span className="size-1.5 rounded-full bg-primary-foreground" />
        ))}
    </span>
  );
}

function QuestionBlock({
  item,
  index,
  total,
  group,
  draft,
  setDraft,
}: {
  item: QuestionItem;
  index: number;
  total: number;
  group: string;
  draft: QuestionDraft;
  setDraft: (next: QuestionDraft) => void;
}) {
  const now = pickOf(draft, item.qid);
  const legendId = `${group}-${item.qid}`;
  const multi = item.multiSelect;
  const type = multi ? "checkbox" : "radio";
  return (
    <fieldset
      className="min-w-0 border-t border-border px-3.5 py-3"
      data-testid="question"
      aria-labelledby={legendId}
    >
      <div id={legendId} className="mb-2">
        {total > 1 && (
          <span className="block text-[11px] font-medium uppercase leading-4 tracking-[0.08em] text-muted-foreground">
            Question {index + 1} of {total}
          </span>
        )}
        <span className="block whitespace-pre-wrap break-words text-[13px] font-medium leading-[18px] text-foreground">
          {item.question}
        </span>
        {multi && !isOpen(item) && (
          <span className="block text-xs leading-4 text-muted-foreground">
            Pick any that apply
          </span>
        )}
      </div>
      {isOpen(item) ? (
        <Textarea
          aria-labelledby={legendId}
          placeholder="Your answer"
          rows={2}
          maxLength={2000}
          value={now.other}
          onChange={(e) => setDraft(typeOther(draft, item, e.target.value))}
          className="min-h-16 resize-y text-[13px]"
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          {(item.choices ?? []).map((choice, i) => {
            const on = now.picks.includes(choice) && !(now.otherOn && !multi);
            return (
              <label
                key={`${i}:${choice}`}
                className={cn(
                  rowClass,
                  on
                    ? "border-primary/60 bg-primary/5"
                    : "border-border hover:bg-muted/60",
                )}
              >
                <input
                  type={type}
                  name={`${group}-${item.qid}`}
                  className="sr-only"
                  checked={on}
                  aria-label={choiceLabel(item, i)}
                  onChange={() => setDraft(pickChoice(draft, item, choice))}
                />
                <Mark multi={multi} on={on} />
                {/* The input's aria-label already names the choice and says
                    it is recommended; the visible text is not read again. */}
                <span
                  aria-hidden
                  className="min-w-0 flex-1 whitespace-pre-wrap break-words"
                >
                  {choice}
                </span>
                {item.recommended === i && (
                  <span
                    aria-hidden
                    className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                  >
                    Recommended
                  </span>
                )}
              </label>
            );
          })}
          <div
            className={cn(
              rowClass,
              "cursor-default py-1",
              now.otherOn
                ? "border-primary/60 bg-primary/5"
                : "border-border hover:bg-muted/60",
            )}
          >
            <label className="relative flex shrink-0 cursor-pointer items-center gap-2.5">
              <input
                type={type}
                name={`${group}-${item.qid}`}
                className="sr-only"
                checked={now.otherOn}
                aria-label="Other"
                onChange={() => setDraft(toggleOther(draft, item))}
              />
              <Mark multi={multi} on={now.otherOn} />
              <span aria-hidden>Other</span>
            </label>
            <Input
              size="sm"
              maxLength={2000}
              aria-label={`Other answer: ${item.question}`}
              placeholder="Type your own answer"
              value={now.other}
              onChange={(e) => setDraft(typeOther(draft, item, e.target.value))}
              className="h-7 flex-1 text-[13px]"
            />
          </div>
        </div>
      )}
    </fieldset>
  );
}

/**
 * The card the live run waits on: pick or type, then Send answer, or Skip.
 * A message sent from the composer answers it too (the server's rule).
 */
export default function QuestionCard({
  question,
  sending,
  error,
  onAnswer,
  onSkip,
}: {
  question: ChatQuestion;
  /** An answer or a skip is on its way. */
  sending: "answer" | "skip" | null;
  error?: string;
  onAnswer: (answers: Record<string, QuestionAnswer>) => void;
  onSkip: () => void;
}) {
  const group = useId();
  const titleId = `${group}-title`;
  const questions = question.questions ?? [];
  const [draft, setDraft] = useState<QuestionDraft>({});
  const { left, label } = useSecondsLeft(question);
  const problem = sendProblem(questions, draft);
  const busy = sending !== null;
  const timeUp = left !== null && left <= 0;
  return (
    <section
      aria-labelledby={titleId}
      data-testid="question-card"
      data-state={busy ? "sending" : "waiting"}
      className="max-w-full overflow-hidden rounded-xl border border-primary/30 bg-card sm:max-w-[86%]"
    >
      <div className="flex items-start gap-2.5 px-3.5 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
          <MessageCircleQuestionMark aria-hidden className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span
            id={titleId}
            className="block text-[13px] font-semibold leading-[18px]"
          >
            {QUESTION_CARD_TITLES.waiting}
          </span>
          <span className="block text-xs leading-4 text-muted-foreground">
            It waits for you. You can also type your answer below.
          </span>
        </span>
        {(label || timeUp) && (
          <span
            className={cn(
              "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium tabular-nums",
              left !== null && left <= 60
                ? "bg-warning/15 text-warning-text"
                : "bg-muted text-muted-foreground",
            )}
            data-testid="question-time-left"
          >
            <Clock aria-hidden className="size-3" />
            {timeUp ? "Time is up" : label}
          </span>
        )}
      </div>
      <fieldset disabled={busy} className="min-w-0">
        {questions.map((item, index) => (
          <QuestionBlock
            key={item.qid}
            item={item}
            index={index}
            total={questions.length}
            group={group}
            draft={draft}
            setDraft={setDraft}
          />
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-border px-3.5 py-2.5">
        <span
          aria-live="polite"
          className="min-w-0 flex-1 basis-40 text-xs leading-4 text-muted-foreground"
        >
          {busy
            ? sending === "skip"
              ? "Skipping…"
              : "Sending your answer…"
            : problem}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            loading={sending === "skip"}
            onClick={onSkip}
          >
            Skip
          </Button>
          <Button
            size="sm"
            disabled={busy || !!problem}
            loading={sending === "answer"}
            onClick={() => onAnswer(draftAnswers(questions, draft))}
          >
            Send answer
          </Button>
        </span>
      </div>
      {error && (
        <p
          role="alert"
          className="border-t border-border px-3.5 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      )}
    </section>
  );
}

const closedIcon: Record<QuestionCardState, typeof Check> = {
  waiting: MessageCircleQuestionMark,
  answered: Check,
  skipped: SkipForward,
  expired: TimerOff,
  stopped: Ban,
};

/** A card whose wait ended: what was asked and what came back, as a short summary. */
export function ClosedQuestionCard({
  card,
  at,
}: {
  card: AnsweredQuestion;
  /** When the wait ended (the message's time). */
  at: string;
}) {
  const { state, title, note, lines, anyAnswer, reply } = closedCard(card);
  const Icon = closedIcon[state];
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      data-testid="question-closed"
      data-state={state}
      className={cn(
        "max-w-full rounded-xl border border-border px-3.5 py-3 sm:max-w-[86%]",
        state === "answered" ? "bg-card" : "bg-muted/30",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full",
            state === "answered"
              ? "bg-success/15 text-success-text"
              : state === "expired"
                ? "bg-warning/15 text-warning-text"
                : "bg-muted text-muted-foreground",
          )}
        >
          <Icon aria-hidden className="size-3" strokeWidth={2.5} />
        </span>
        <span
          id={titleId}
          className="min-w-0 flex-1 text-[13px] font-semibold leading-[18px]"
        >
          {title}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {timeOfDay(at)}
        </span>
      </div>
      {reply ? (
        // One message answered every question: show it once.
        <div className="mt-1.5 pl-7">
          <ul aria-label="What Timely asked" className="flex flex-col gap-0.5">
            {lines.map((line) => (
              <li
                key={line.qid}
                className="whitespace-pre-wrap break-words text-xs leading-4 text-muted-foreground"
              >
                {line.question}
              </li>
            ))}
          </ul>
          <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-[18px]">
            <span className="text-muted-foreground">You replied: </span>
            <span className="font-medium text-foreground">{reply}</span>
          </p>
        </div>
      ) : anyAnswer ? (
        <dl className="mt-2 flex flex-col gap-2 pl-7">
          {lines.map((line) => (
            <div key={line.qid} className="min-w-0">
              <dt className="whitespace-pre-wrap break-words text-xs leading-4 text-muted-foreground">
                {line.question}
              </dt>
              <dd
                className={cn(
                  "whitespace-pre-wrap break-words text-[13px] leading-[18px]",
                  line.empty
                    ? "text-muted-foreground"
                    : "font-medium text-foreground",
                )}
              >
                {line.answer}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        // Nothing came back: only what was asked.
        <ul
          aria-label="What Timely asked"
          className="mt-1.5 flex flex-col gap-0.5 pl-7"
        >
          {lines.map((line) => (
            <li
              key={line.qid}
              className="whitespace-pre-wrap break-words text-[13px] leading-[18px] text-muted-foreground"
            >
              {line.question}
            </li>
          ))}
        </ul>
      )}
      {note && (
        <p className="mt-2 pl-7 text-xs leading-4 text-muted-foreground">
          {note}
        </p>
      )}
    </section>
  );
}
