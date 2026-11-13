import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import {
  Ban,
  Check,
  Clock,
  MessageCircleQuestionMark,
  Pencil,
  SkipForward,
  TimerOff,
  type LucideIcon,
} from "lucide-react-native";
import {
  QUESTION_CARD_TITLES,
  QUESTION_LIMITS,
  questionSecondsLeft,
  questionTimeLeft,
  type AnsweredQuestion,
  type ChatQuestion,
  type QuestionAnswer,
  type QuestionCardState,
  type QuestionItem,
} from "@timely/contract/agentChat";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import {
  choiceLabel,
  closedCard,
  draftAnswers,
  isOpen,
  pickChoice,
  pickOf,
  sendProblem,
  typeOther,
  type QuestionDraft,
} from "../../lib/chat/question";
import AnimatedPressable from "../ui/AnimatedPressable";
import BottomSheet from "../ui/BottomSheet";
import { Button } from "../ui/primitives";
import { timeOfDay } from "./chatMeta";

/**
 * The question card on the phone (phase 4, Q-4.3), the same states and words
 * as the web card: one to five questions, a row per choice (the recommended
 * one marked), an "Other" row on every question, Skip and Send answer, and
 * the time left. Typed answers are written in a sheet, not in the card: an
 * inline field is cramped at 390 wide and the keyboard would cover the card.
 * The questions come from the model, so they show as plain text.
 */

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

function Mark({ multi, on }: { multi: boolean; on: boolean }) {
  return (
    <View
      style={[
        styles.mark,
        multi ? styles.markBox : styles.markRound,
        on && styles.markOn,
      ]}
    >
      {on ? (
        multi ? (
          <Check size={12} strokeWidth={3} color={colors.primaryForeground} />
        ) : (
          <View style={styles.markDot} />
        )
      ) : null}
    </View>
  );
}

/** One question: its choices and the Other row, or the typed-answer row of an open question. */
function QuestionBlock({
  item,
  index,
  total,
  draft,
  disabled,
  onChange,
  onType,
}: {
  item: QuestionItem;
  index: number;
  total: number;
  draft: QuestionDraft;
  disabled: boolean;
  onChange: (next: QuestionDraft) => void;
  onType: (item: QuestionItem) => void;
}) {
  const now = pickOf(draft, item.qid);
  const multi = item.multiSelect;
  const role = multi ? "checkbox" : "radio";
  return (
    <View style={styles.block} testID="question">
      <View style={{ gap: 2 }}>
        {total > 1 ? (
          <Text
            style={styles.eyebrow}
          >{`Question ${index + 1} of ${total}`}</Text>
        ) : null}
        <Text style={styles.question}>{item.question}</Text>
        {multi && !isOpen(item) ? (
          <Text style={styles.meta}>Pick any that apply</Text>
        ) : null}
      </View>
      {isOpen(item) ? (
        <AnimatedPressable
          testID="question-type"
          accessibilityRole="button"
          accessibilityLabel={
            now.other.trim()
              ? `Your answer: ${now.other}. Edit`
              : `Type your answer: ${item.question}`
          }
          disabled={disabled}
          onPress={() => onType(item)}
          style={[styles.row, now.other.trim() ? styles.rowOn : null]}
        >
          <Pencil size={15} color={colors.mutedForeground} />
          <Text
            numberOfLines={3}
            style={[styles.rowText, !now.other.trim() && styles.placeholder]}
          >
            {now.other.trim() || "Type your answer"}
          </Text>
        </AnimatedPressable>
      ) : (
        <View
          style={{ gap: 6 }}
          accessibilityRole={multi ? undefined : "radiogroup"}
          role={multi ? "group" : undefined}
          accessibilityLabel={item.question}
        >
          {(item.choices ?? []).map((choice, i) => {
            const on = now.picks.includes(choice) && !(now.otherOn && !multi);
            return (
              <AnimatedPressable
                key={`${i}:${choice}`}
                testID="question-choice"
                accessibilityRole={role}
                accessibilityLabel={choiceLabel(item, i)}
                accessibilityState={{ checked: on, disabled }}
                aria-checked={on}
                disabled={disabled}
                onPress={() => onChange(pickChoice(draft, item, choice))}
                style={[styles.row, on && styles.rowOn]}
              >
                <Mark multi={multi} on={on} />
                <Text style={styles.rowText}>{choice}</Text>
                {item.recommended === i ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>Recommended</Text>
                  </View>
                ) : null}
              </AnimatedPressable>
            );
          })}
          <AnimatedPressable
            testID="question-other"
            // It opens a text box rather than toggling, so it is a button.
            accessibilityRole="button"
            accessibilityLabel={
              now.other.trim()
                ? `Other: ${now.other}. Edit`
                : "Other: type your own answer"
            }
            accessibilityHint="Opens a box to type your answer"
            accessibilityState={{ selected: now.otherOn, disabled }}
            disabled={disabled}
            onPress={() => onType(item)}
            style={[styles.row, now.otherOn && styles.rowOn]}
          >
            <Mark multi={multi} on={now.otherOn} />
            <Text
              numberOfLines={3}
              style={[styles.rowText, !now.other.trim() && styles.placeholder]}
            >
              {now.other.trim() ? `Other: ${now.other.trim()}` : "Other…"}
            </Text>
            <Pencil size={14} color={colors.mutedForeground} />
          </AnimatedPressable>
        </View>
      )}
    </View>
  );
}

/** The sheet a typed answer is written in. The field blurs before the sheet closes (RN Android moves focus otherwise). */
function AnswerSheet({
  item,
  initial,
  onDone,
}: {
  item: QuestionItem | null;
  initial: string;
  onDone: (text: string) => void;
}) {
  const input = useRef<TextInput>(null);
  const [text, setText] = useState(initial);
  useEffect(() => setText(initial), [initial, item?.qid]);
  // The card can close from the server (time limit, Stop on another device,
  // an answer from the web) with the field focused: blur it before it goes,
  // or Android moves the focus to the first input on screen, the composer.
  useLayoutEffect(
    () => () => {
      input.current?.blur();
    },
    [],
  );
  const done = () => {
    input.current?.blur();
    onDone(text);
  };
  return (
    <BottomSheet
      open={!!item}
      onClose={done}
      title={item && isOpen(item) ? "Your answer" : "Other answer"}
      subtitle={item?.question}
      footer={
        <Button
          testID="question-sheet-done"
          label="Done"
          onPress={done}
          stretch
        />
      }
    >
      <TextInput
        ref={input}
        testID="question-sheet-input"
        accessibilityLabel={item ? `Answer: ${item.question}` : "Answer"}
        value={text}
        onChangeText={setText}
        placeholder="Type your answer"
        placeholderTextColor={colors.mutedForeground}
        selectionColor={colors.primary}
        multiline
        autoFocus
        maxLength={QUESTION_LIMITS.answerChars}
        style={styles.sheetInput}
      />
    </BottomSheet>
  );
}

/** The card the live run waits on. A message sent from the composer answers it too. */
export default function QuestionCard({
  question,
  sending,
  error,
  onAnswer,
  onSkip,
}: {
  question: ChatQuestion;
  sending: "answer" | "skip" | null;
  error?: string;
  /** Missing while offline: the card shows with its buttons off. */
  onAnswer?: (answers: Record<string, QuestionAnswer>) => void;
  onSkip?: () => void;
}) {
  const questions = question.questions ?? [];
  const [draft, setDraft] = useState<QuestionDraft>({});
  const [typing, setTyping] = useState<QuestionItem | null>(null);
  const { left, label } = useSecondsLeft(question);
  const problem = sendProblem(questions, draft);
  const busy = sending !== null;
  const timeUp = left !== null && left <= 0;
  const soon = left !== null && left <= 60;
  function typed(text: string) {
    const item = typing;
    setTyping(null);
    if (!item) return;
    // An empty Other on a single-choice question leaves the picked choice as it was.
    if (!item.multiSelect && !isOpen(item) && !text.trim())
      setDraft({
        ...draft,
        [item.qid]: { ...pickOf(draft, item.qid), other: "", otherOn: false },
      });
    else setDraft(typeOther(draft, item, text));
  }
  return (
    <View testID="question-card" style={[styles.card, styles.cardLive]}>
      <View style={styles.head}>
        <View style={styles.tile}>
          <MessageCircleQuestionMark size={16} color={colors.primary} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" style={styles.title}>
            {QUESTION_CARD_TITLES.waiting}
          </Text>
          <Text style={styles.meta}>
            It waits for you. You can also type your answer below.
          </Text>
        </View>
        {label || timeUp ? (
          <View
            testID="question-time-left"
            style={[styles.timePill, soon && styles.timePillSoon]}
          >
            <Clock
              size={11}
              color={soon ? colors.warningText : colors.mutedForeground}
            />
            <Text
              style={[styles.timeText, soon && { color: colors.warningText }]}
            >
              {timeUp ? "Time is up" : label}
            </Text>
          </View>
        ) : null}
      </View>
      {questions.map((item, index) => (
        <QuestionBlock
          key={item.qid}
          item={item}
          index={index}
          total={questions.length}
          draft={draft}
          disabled={busy}
          onChange={setDraft}
          onType={setTyping}
        />
      ))}
      <View style={styles.footer}>
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.meta, { flex: 1 }]}
        >
          {busy
            ? sending === "skip"
              ? "Skipping…"
              : "Sending your answer…"
            : (problem ?? "")}
        </Text>
        <Button
          testID="question-skip"
          label="Skip"
          variant="ghost"
          size="sm"
          disabled={busy || !onSkip}
          loading={sending === "skip"}
          onPress={() => onSkip?.()}
        />
        <Button
          testID="question-send"
          label="Send answer"
          size="sm"
          disabled={busy || !!problem || !onAnswer}
          loading={sending === "answer"}
          onPress={() => onAnswer?.(draftAnswers(questions, draft))}
        />
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <AnswerSheet
        item={typing}
        initial={typing ? pickOf(draft, typing.qid).other : ""}
        onDone={typed}
      />
    </View>
  );
}

const closedIcons: Record<QuestionCardState, LucideIcon> = {
  waiting: MessageCircleQuestionMark,
  answered: Check,
  skipped: SkipForward,
  expired: TimerOff,
  stopped: Ban,
};

/** A card whose wait ended, as a short summary: what was asked and what came back. */
export function ClosedQuestionCard({
  card,
  at,
}: {
  card: AnsweredQuestion;
  at: string;
}) {
  const { state, title, note, lines, anyAnswer, reply } = closedCard(card);
  const Icon = closedIcons[state];
  const tone =
    state === "answered"
      ? colors.successText
      : state === "expired"
        ? colors.warningText
        : colors.mutedForeground;
  return (
    <View
      testID={`question-closed-${state}`}
      style={[styles.card, state !== "answered" && styles.cardMuted]}
    >
      <View style={styles.head}>
        <View style={[styles.closedIcon, { backgroundColor: `${tone}26` }]}>
          <Icon size={12} strokeWidth={2.5} color={tone} />
        </View>
        <Text accessibilityRole="header" style={[styles.title, { flex: 1 }]}>
          {title}
        </Text>
        <Text style={styles.meta}>{timeOfDay(at)}</Text>
      </View>
      {reply ? (
        // One message answered every question: show it once.
        <View style={styles.summaryLine}>
          {lines.map((line) => (
            <Text key={line.qid} style={styles.meta}>
              {line.question}
            </Text>
          ))}
          <Text style={[styles.answer, { marginTop: 6 }]}>
            <Text
              style={{ color: colors.mutedForeground, fontWeight: "400" }}
            >
              You replied:{" "}
            </Text>
            {reply}
          </Text>
        </View>
      ) : anyAnswer ? (
        lines.map((line) => (
          <View key={line.qid} style={styles.summaryLine}>
            <Text style={styles.meta}>{line.question}</Text>
            <Text
              style={[
                styles.answer,
                line.empty && {
                  color: colors.mutedForeground,
                  fontWeight: "400",
                },
              ]}
            >
              {line.answer}
            </Text>
          </View>
        ))
      ) : (
        // Nothing came back: only what was asked.
        <View style={styles.summaryLine}>
          {lines.map((line) => (
            <Text key={line.qid} style={styles.asked}>
              {line.question}
            </Text>
          ))}
        </View>
      )}
      {note ? (
        <Text style={[styles.meta, styles.summaryLine]}>{note}</Text>
      ) : null}
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  cardLive: { borderColor: `${colors.primary}4d` },
  cardMuted: { backgroundColor: colors.background },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  tile: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: `${colors.primary}1a`,
    alignItems: "center",
    justifyContent: "center",
  },
  closedIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: colors.foreground,
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 20,
  },
  meta: { color: colors.mutedForeground, fontSize: 12, lineHeight: 16 },
  eyebrow: {
    color: colors.mutedForeground,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  question: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
  block: {
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  row: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  rowOn: {
    borderColor: `${colors.primary}99`,
    backgroundColor: `${colors.primary}12`,
  },
  // minWidth 0: a long unbroken choice wraps inside its row (flex items keep min-width:auto on web).
  rowText: { flex: 1, flexShrink: 1, minWidth: 0, color: colors.foreground, fontSize: 14, lineHeight: 19 },
  placeholder: { color: colors.mutedForeground },
  mark: {
    width: 18,
    height: 18,
    borderWidth: 1.5,
    borderColor: colors.mutedForeground,
    alignItems: "center",
    justifyContent: "center",
  },
  markRound: { borderRadius: 9 },
  markBox: { borderRadius: 5 },
  markOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  markDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primaryForeground,
  },
  badge: {
    borderRadius: 999,
    backgroundColor: `${colors.primary}1a`,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: { color: colors.primary, fontSize: 11, fontWeight: "600" },
  timePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    backgroundColor: colors.muted,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  timePillSoon: { backgroundColor: `${colors.warning}26` },
  timeText: {
    color: colors.mutedForeground,
    fontSize: 11,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  error: { color: colors.destructive, fontSize: 12, lineHeight: 16 },
  summaryLine: { paddingLeft: 30, gap: 1 },
  asked: { color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  answer: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 19,
  },
  sheetInput: {
    minHeight: 120,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.card,
    color: colors.foreground,
    fontSize: 15,
    lineHeight: 21,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    textAlignVertical: "top",
  },
}));
