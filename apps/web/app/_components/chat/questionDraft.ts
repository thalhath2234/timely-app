/**
 * The question card's rules (phase 4, Q-4.3): what the person picked or typed
 * for each question, the answers that go to POST /chats/:id/answer, and the
 * words the card and the composer use. Pure functions, the same as the
 * phone's lib/chat/question.ts, so `make test-mobile-assistant` checks both.
 */
import {
  QUESTION_CARD_TITLES,
  answerProblem,
  cleanAnswers,
  questionCardState,
  type AnsweredQuestion,
  type QuestionAnswer,
  type QuestionCardState,
  type QuestionItem,
} from "@timely/contract/agentChat";

/** One question's picks: the choices ticked, and the typed "Other" text. */
export type QuestionPick = { picks: string[]; other: string; otherOn: boolean };
export type QuestionDraft = Record<string, QuestionPick>;

const blank: QuestionPick = { picks: [], other: "", otherOn: false };

export function pickOf(draft: QuestionDraft, qid: string): QuestionPick {
  return draft[qid] ?? blank;
}

/** An open question takes typed text only. */
export function isOpen(item: QuestionItem): boolean {
  return !item.choices?.length;
}

/** Ticks a choice: a single-select question keeps only it, a multi-select one toggles it. */
export function pickChoice(
  draft: QuestionDraft,
  item: QuestionItem,
  choice: string,
): QuestionDraft {
  const now = pickOf(draft, item.qid);
  if (!item.multiSelect)
    return {
      ...draft,
      [item.qid]: { ...now, picks: [choice], otherOn: false },
    };
  const picks = now.picks.includes(choice)
    ? now.picks.filter((p) => p !== choice)
    : [...now.picks, choice];
  return { ...draft, [item.qid]: { ...now, picks } };
}

/** Turns "Other" on (single-select: in place of a choice) or, for multi-select, off again. */
export function toggleOther(
  draft: QuestionDraft,
  item: QuestionItem,
): QuestionDraft {
  const now = pickOf(draft, item.qid);
  if (!item.multiSelect)
    return { ...draft, [item.qid]: { ...now, picks: [], otherOn: true } };
  return { ...draft, [item.qid]: { ...now, otherOn: !now.otherOn } };
}

/** Typing an answer picks "Other"; clearing it in a multi-select question unticks it. */
export function typeOther(
  draft: QuestionDraft,
  item: QuestionItem,
  text: string,
): QuestionDraft {
  const now = pickOf(draft, item.qid);
  const typed = text.trim() !== "";
  if (item.multiSelect)
    return { ...draft, [item.qid]: { ...now, other: text, otherOn: typed } };
  return {
    ...draft,
    [item.qid]: { picks: typed ? [] : now.picks, other: text, otherOn: true },
  };
}

/** The answers to send: one per question, null where nothing was picked or typed. */
export function draftAnswers(
  questions: QuestionItem[],
  draft: QuestionDraft,
): Record<string, QuestionAnswer> {
  const raw: Record<string, QuestionAnswer> = {};
  for (const item of questions) {
    const now = pickOf(draft, item.qid);
    if (isOpen(item)) raw[item.qid] = now.other;
    else if (item.multiSelect) {
      const picks = (item.choices ?? []).filter((c) => now.picks.includes(c));
      raw[item.qid] =
        now.otherOn && now.other.trim() ? [...picks, now.other] : picks;
    } else raw[item.qid] = now.otherOn ? now.other : (now.picks[0] ?? null);
  }
  return cleanAnswers(raw);
}

/** How many questions have an answer. */
export function answeredCount(
  questions: QuestionItem[],
  draft: QuestionDraft,
): number {
  return Object.values(draftAnswers(questions, draft)).filter((a) => a !== null)
    .length;
}

/** Why Send answer is off, or null when the answers can go. */
export function sendProblem(
  questions: QuestionItem[],
  draft: QuestionDraft,
): string | null {
  if (!answeredCount(questions, draft))
    return questions.length > 1
      ? "Answer at least one question, or skip."
      : questions.every(isOpen)
        ? "Type an answer, or skip."
        : "Pick or type an answer, or skip.";
  return answerProblem(questions, draftAnswers(questions, draft));
}

/** The composer while a card waits: a message sent now answers it. */
export const QUESTION_PLACEHOLDER = "Type your answer, or use the card above…";
export const QUESTION_HINT = "What you send now answers Timely’s question.";
/** The header's subtitle and the activity card's line while a card waits. */
export const QUESTION_WAITING_LINE = "Waiting for your answer";
/** Under a card that expired or was stopped. */
const CLOSED_NOTES: Partial<Record<QuestionCardState, string>> = {
  skipped: "Timely went on without an answer.",
  expired: "Timely went on without your answer.",
  stopped: "The run stopped while it waited.",
};

/**
 * A closed card's title, note, and one line per question ("No answer" where
 * none came). anyAnswer is false when nothing came back: the card then lists
 * only what was asked.
 */
export function closedCard(card: AnsweredQuestion): {
  state: QuestionCardState;
  title: string;
  note: string;
  anyAnswer: boolean;
  /** The one text that answered every question of a card with more than one (a message typed in the composer), else "". */
  reply: string;
  lines: { qid: string; question: string; answer: string; empty: boolean }[];
} {
  const state = questionCardState(card.outcome);
  const lines = (card.questions ?? []).map((q) => {
    const value = card.answers?.[q.qid];
    const answer = Array.isArray(value)
      ? value.join(", ")
      : typeof value === "string"
        ? value
        : "";
    return {
      qid: q.qid,
      question: q.question,
      answer: answer || "No answer",
      empty: !answer,
    };
  });
  // A message typed in the composer answers every question with the same
  // text. Two questions answered with the same pick are not that: the text
  // collapses only when it is no question's choice, and never for a multi-pick.
  const questions = card.questions ?? [];
  const first = card.answers?.[questions[0]?.qid ?? ""];
  const same =
    questions.length > 1 &&
    typeof first === "string" &&
    first !== "" &&
    questions.every(
      (q) =>
        card.answers?.[q.qid] === first && !(q.choices ?? []).includes(first),
    );
  return {
    state,
    title: QUESTION_CARD_TITLES[state],
    note: CLOSED_NOTES[state] ?? "",
    anyAnswer: lines.some((l) => !l.empty),
    reply: same ? lines[0].answer : "",
    lines,
  };
}

/** The screen-reader name of a choice row: its text, and "recommended" when the agent marked it. */
export function choiceLabel(item: QuestionItem, index: number): string {
  const choice = item.choices?.[index] ?? "";
  return item.recommended === index ? `${choice} (recommended)` : choice;
}
