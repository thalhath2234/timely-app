"use client";

// Before @openuidev/react-lang, which reads its devtools flag as it loads.
import "../genui/setup";
import { Fragment, useContext, useMemo, useState, createContext } from "react";
import { CalendarDays } from "lucide-react";
import { createLibrary, Renderer, type ComponentRenderer } from "@openuidev/react-lang";
import {
  GENUI_ROOT,
  genuiNodes,
  isBoardBlock,
  splitReply,
  spokenTime,
  withRenderers,
  type GenuiName,
  type GenuiProps,
} from "@timely/contract/genui";
import { cn } from "@/app/utils/cn";
import { propertyChipClass } from "@/app/_components/_ui/propertyChip";
import DatePicker from "@/app/_components/_ui/datePicker";
import Button from "@/app/_components/_ui/button";
import { Ask, kit, type KitProps } from "../genui/kit";
import ChatText from "./chatText";

/*
 * Reply cards on web and desktop: the agent's ```openui-lang programs
 * (packages/contract/src/genui.ts) drawn with the shared kit (../genui/kit).
 * An answer chip sends the person's reply. In a wide conversation the cards
 * run past the text column, centred on it (the scroller is `@container/chat`),
 * and Columns sit side by side; a narrow one stacks them.
 */

/** This is the newest reply, so its Choices still answer it. */
const Newest = createContext(false);

// 40px is the avatar and gap before the reply column; the board stays centred
// on the 768px column and grows to 1000px as the conversation allows.
const WIDE =
  "@3xl/chat:w-[min(1000px,100cqw)] @3xl/chat:ml-[calc((48rem_-_min(1000px,100cqw))/2_-_40px)]";

function Reply({ props, renderNode }: KitProps<"Reply">) {
  const blocks = genuiNodes(props.blocks);
  const wide = blocks.some(isBoardBlock);
  return (
    <div className="mt-3 flex flex-col gap-3">
      {blocks.map((block, index) =>
        block.typeName === "Choices" ? (
          <Fragment key={index}>{renderNode(block)}</Fragment>
        ) : (
          <div key={index} className={cn("@container/board", wide && WIDE)}>
            {renderNode(block)}
          </div>
        ),
      )}
    </div>
  );
}

function Choices({ props }: KitProps<"Choices">) {
  const ask = useContext(Ask);
  const answer = useContext(Newest) ? ask : undefined;
  const [picked, setPicked] = useState("");
  // The picker reports every day and time tap, so a picked time waits for Send.
  const [time, setTime] = useState("");
  const send = (text: string) => {
    if (!answer || !text) return;
    setPicked(text);
    answer(text);
  };
  const options = (Array.isArray(props.options) ? props.options : []).slice(0, 4);
  return (
    <div role="group" aria-label="Suggested answers" className="flex flex-wrap items-center gap-2">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          disabled={!answer}
          onClick={() => send(option)}
          className={propertyChipClass({ active: picked === option })}
        >
          {option}
        </button>
      ))}
      {props.pickTime ? (
        <DatePicker
          mode="datetime"
          variant="chip"
          chipLabel="Pick a time…"
          value={time}
          disabled={!answer}
          icon={<CalendarDays />}
          aria-label="Pick a time"
          onChange={setTime}
        />
      ) : null}
      {time && answer ? (
        <Button size="sm" onClick={() => send(spokenTime(new Date(time)))}>
          Send
        </Button>
      ) : null}
    </div>
  );
}

const renderers: { [N in GenuiName]: ComponentRenderer<GenuiProps<N>> } = { ...kit, Reply, Choices };

const library = createLibrary({ components: withRenderers(renderers), root: GENUI_ROOT });

function Cards({ code }: { code: string }) {
  const [empty, setEmpty] = useState(false);
  if (empty) return <p className="mt-2 text-xs text-muted-foreground">These cards could not be shown.</p>;
  return (
    <Renderer
      response={code}
      library={library}
      publishObservability={false}
      onParseResult={(result) => setEmpty(Boolean(result) && !result?.root)}
    />
  );
}

/**
 * An assistant reply: its text, with any reply cards drawn where the agent put
 * them. `ask` sends a card's text (an answer chip, "Plan something") as the
 * person's next message; leave it unset while the chat can't take one. Only
 * the `newest` reply's answer chips stay live.
 */
export default function ReplyBody({
  content,
  ask,
  newest = false,
}: {
  content: string;
  ask?: (text: string) => void;
  newest?: boolean;
}) {
  const parts = useMemo(() => splitReply(content), [content]);
  return (
    <Ask.Provider value={ask}>
      <Newest.Provider value={newest}>
        {parts.map((part, index) =>
          part.kind === "text" ? (
            <div key={index} className={index ? "mt-3" : undefined}>
              <ChatText text={part.text} />
            </div>
          ) : (
            <Cards key={index} code={part.code} />
          ),
        )}
      </Newest.Provider>
    </Ask.Provider>
  );
}
