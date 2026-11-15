"use client";

import type { CSSProperties, KeyboardEvent, ReactNode, Ref } from "react";
import { X } from "lucide-react";
import type { HealthTone } from "@timely/contract/bots";
import Button from "@/app/_components/_ui/button";
import { cn } from "@/app/utils/cn";

export const TONE_CHIP: Record<HealthTone, string> = {
  ok: "bg-success/12 text-success-text",
  warn: "bg-warning/12 text-warning-text",
  bad: "bg-destructive/10 text-destructive",
  off: "bg-fill text-muted-foreground",
  primary: "bg-primary/12 text-primary",
};

export function Chip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-fill px-2.5 text-xs font-medium tabular-nums text-muted-foreground [&_svg]:size-3",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** The panel's frame: the rounded sheet beside the board, no scrim. */
export function PanelFrame({
  label,
  children,
  onKeyDown,
  frameRef,
}: {
  label: string;
  children: ReactNode;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  frameRef?: Ref<HTMLElement>;
}) {
  return (
    <section
      ref={frameRef}
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="bots-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[20px] border border-border-strong bg-background outline-none"
    >
      {children}
    </section>
  );
}

/** The panel's body: editor on the left, rail on the right, one column when the panel is narrow. */
export function PanelBody({
  editor,
  rail,
}: {
  editor: ReactNode;
  rail: ReactNode;
}) {
  return (
    <div className="@container min-h-0 flex-1 overflow-y-auto">
      <div
        className="grid items-start gap-4 px-6 pb-6 pt-5 @[960px]:grid-cols-[minmax(0,1fr)_var(--rail)]"
        style={{ "--rail": "clamp(320px, 28%, 420px)" } as CSSProperties}
      >
        <div className="min-w-0">{editor}</div>
        <aside className="grid min-w-0 items-start gap-4 @[700px]:grid-cols-2 @[700px]:[&>*:last-child:nth-child(odd)]:col-span-2 @[960px]:grid-cols-1 @[960px]:[&>*:last-child:nth-child(odd)]:col-span-1">
          {rail}
        </aside>
      </div>
    </div>
  );
}

/** Escape closes the panel, unless a dialog, menu or list inside it has it. */
export function escapeCloses(close: () => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (
      (event.target as HTMLElement).closest(
        '[role="dialog"],[role="menu"],[role="listbox"],[aria-expanded="true"]',
      )
    )
      return;
    close();
  };
}

export function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <Button variant="ghost" size="sm" icon aria-label="Close" onClick={onClose}>
      <X />
    </Button>
  );
}

/** The panel when the bot is still loading, or gone. */
export function PanelNotice({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <PanelFrame label="Bot">
      <div className="flex items-center justify-end border-b border-border bg-card px-5 py-3">
        <CloseButton onClose={onClose} />
      </div>
      <div className="p-6">{children}</div>
    </PanelFrame>
  );
}

/** The bot's name, typed in place as the panel's title; a long name wraps instead of being cut. */
export function NameField({
  value,
  onChange,
}: {
  value: string;
  onChange: (name: string) => void;
}) {
  return (
    <textarea
      aria-label="Bot name"
      value={value}
      rows={1}
      placeholder="Name your bot"
      maxLength={120}
      // A name is one line: a pasted line break becomes a space.
      onChange={(event) =>
        onChange(event.target.value.replace(/[\r\n]+/g, " "))
      }
      className="-mx-1.5 min-w-0 flex-1 resize-none rounded-md bg-transparent px-1.5 py-1 text-[22px] font-semibold leading-7 tracking-[-0.02em] text-foreground outline-none transition-colors [field-sizing:content] placeholder:text-muted-foreground hover:bg-muted/60 focus:bg-muted/60"
    />
  );
}
export const descClass =
  "-mx-1.5 block w-[calc(100%+12px)] max-w-[692px] resize-none rounded-md bg-transparent px-1.5 py-0.5 text-sm leading-[22px] text-foreground outline-none transition-colors [field-sizing:content] placeholder:text-muted-foreground hover:bg-muted/60 focus:bg-muted/60";
