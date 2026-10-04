import type React from "react";
import { useRef, useState } from "react";
import { Composer } from "@timely/ui";

type Props = Partial<React.ComponentProps<typeof Composer>> & { initial?: string };

function Live({ initial = "", ...props }: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(initial);
  const [webSearch, setWebSearch] = useState(props.webSearch ?? false);
  return (
    <div className="bg-background pt-4" style={{ width: 720 }}>
      <Composer
        inputRef={inputRef}
        draft={draft}
        setDraft={setDraft}
        placeholder="Ask Timely to create, plan, or update…"
        chips={[]}
        onRemoveChip={() => {}}
        images={[]}
        uploading={false}
        addFiles={() => {}}
        removeImage={() => {}}
        sensitive={false}
        busy={false}
        pending={false}
        onSend={() => {}}
        onStop={() => {}}
        hint="Simple changes happen directly. Larger changes are yours to review."
        {...props}
        webSearch={webSearch}
        onToggleSearch={() => setWebSearch((on) => !on)}
      />
    </div>
  );
}

export const Empty = () => <Live />;

export const WithContextAndDraft = () => (
  <Live
    initial="Find two hours before Friday for the research synthesis — mornings only."
    webSearch
    chips={[
      { kind: "project", label: "Website relaunch", value: "p_web" },
      { kind: "calendar", label: "This week", value: "week" },
    ]}
  />
);

export const Running = () => (
  <Live
    busy
    initial=""
    chips={[{ kind: "today", label: "Today", value: "today" }]}
  />
);

export const Sending = () => (
  <Live pending initial="Move the dentist appointment to Friday morning." />
);

export const AwaitingReview = () => (
  <Live
    placeholder="Tell me what to change…"
    initial="Keep the client review at 14:00, move everything else after lunch."
  />
);

export const UploadingReceipt = () => (
  <Live
    uploading
    sensitive
    initial="Add this to my expenses sheet."
    hint="Image-based changes always need your review."
  />
);

const inAnHour = () => new Date(Date.now() + 60 * 60_000).toISOString();

export const ImageAttached = () => (
  <Live
    sensitive
    initial="Turn these sticky notes into tasks for next week."
    images={[{ id: "img_whiteboard", name: "whiteboard.jpg", expiresAt: inAnHour() }]}
    hint="Image-based changes always need your review."
  />
);
