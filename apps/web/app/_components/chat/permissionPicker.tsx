"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Eye, ShieldCheck, Zap } from "lucide-react";
import {
  FULL_ACCESS_CONFIRM,
  PERMISSION_COPY,
  PERMISSION_MODES,
  type PermissionMode,
} from "@timely/contract/agentChat";
import { requestConfirm } from "@/app/_store/confirmStore";
import { cn } from "@/app/utils/cn";

/**
 * How much the agent may change without asking (plan 5.5b), as drawn in
 * Option1Permissions: a chip in the tone of the mode (green eye Supervised,
 * indigo shield Auto, amber bolt Full Access) that opens a three-way picker.
 * The composer uses it for one chat, Settings → Agent for the defaults.
 */

const ICONS = { eye: Eye, shield: ShieldCheck, bolt: Zap } as const;

/** The chip's fill and text; Full Access also gets a hairline in its tone. */
const CHIP_TONE = {
  green: "bg-success/12 text-success-text",
  indigo: "bg-primary/10 text-primary",
  amber: "border-warning/45 bg-warning/12 text-warning-text",
} as const;

/** The option's icon tile in the picker. */
const TILE_TONE = {
  green: "bg-success/12 text-success-text",
  indigo: "bg-primary/15 text-primary",
  amber: "bg-warning/12 text-warning-text",
} as const;

export function modeName(mode: PermissionMode | undefined) {
  return PERMISSION_COPY[mode ?? "supervised"].name;
}

/** The mode as a pill. `md` is the composer's chip, `sm` a settings row's value. */
export function PermissionChip({
  mode,
  size = "md",
  caret = false,
  className,
}: {
  mode: PermissionMode;
  size?: "md" | "sm";
  caret?: boolean;
  className?: string;
}) {
  const copy = PERMISSION_COPY[mode];
  const Icon = ICONS[copy.icon];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-transparent font-semibold whitespace-nowrap",
        size === "md"
          ? "h-7 gap-1.5 pl-[9px] pr-2 text-xs"
          : "h-[22px] gap-1 px-2 text-[11px]",
        CHIP_TONE[copy.tone],
        className,
      )}
    >
      <Icon aria-hidden className={size === "md" ? "size-3.5" : "size-3"} />
      {copy.name}
      {caret && <ChevronDown aria-hidden className="size-3.5" />}
    </span>
  );
}

/**
 * Asks once before Full Access is turned on, saying what still asks in
 * phase 2 (it works like Auto for Timely data), then calls `onConfirm`.
 */
export function confirmFullAccess(
  scope: "chat" | "new chats" | "bots",
  onConfirm: () => void,
) {
  const lead = FULL_ACCESS_CONFIRM.replace(
    /\s*Turn it on for this chat\?$/,
    "",
  );
  requestConfirm({
    title:
      scope === "chat"
        ? "Turn on Full Access for this chat?"
        : scope === "new chats"
          ? "Start new chats on Full Access?"
          : "Run bots on Full Access?",
    // The title asks the question, so the contract's closing one is left off.
    description: lead,
    confirmLabel: "Turn on Full Access",
    tone: "primary",
    icon: <Zap className="size-5" />,
    onConfirm,
  });
}

/** The three modes as radio rows, each with its description. */
export function PermissionOptions({
  value,
  onPick,
  disabled,
}: {
  value: PermissionMode;
  onPick: (mode: PermissionMode) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Permission"
      className="flex flex-col gap-0.5"
    >
      {PERMISSION_MODES.map((mode) => {
        const copy = PERMISSION_COPY[mode];
        const Icon = ICONS[copy.icon];
        const on = mode === value;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onPick(mode)}
            className={cn(
              "flex w-full cursor-pointer items-start gap-2.5 rounded-[10px] p-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50",
              on ? "bg-primary/10" : "hover:bg-muted/60",
            )}
          >
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-[10px]",
                TILE_TONE[copy.tone],
              )}
            >
              <Icon aria-hidden className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium leading-[18px] text-foreground">
                {copy.name}
              </span>
              <span className="block text-xs leading-4 text-muted-foreground">
                {copy.description}
              </span>
            </span>
            <span
              aria-hidden
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px]",
                on ? "border-primary" : "border-muted-foreground/45",
              )}
            >
              {on && <span className="size-2 rounded-full bg-primary" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * A trigger that opens the picker in a popover above (composer) or below
 * (settings row) it. Picking Full Access asks first (`confirmFullAccess`).
 */
export function PermissionPopover({
  value,
  onChange,
  title,
  scope,
  footer,
  trigger,
  placement = "above",
  disabled,
  className,
}: {
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void;
  /** The eyebrow above the options. */
  title: string;
  scope: "chat" | "new chats" | "bots";
  /** Under the options; gets a function that closes the popover. */
  footer?: (close: () => void) => ReactNode;
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  placement?: "above" | "below";
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const pick = (mode: PermissionMode) => {
    setOpen(false);
    if (mode === value) return;
    if (mode === "full") confirmFullAccess(scope, () => onChange(mode));
    else onChange(mode);
  };
  return (
    <div ref={wrap} className={cn("relative", className)}>
      {trigger({ open, toggle: () => !disabled && setOpen((o) => !o) })}
      {open && (
        <div
          role="dialog"
          aria-label={title}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            // Close only the picker, not the chat dialog around it.
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }}
          className={cn(
            "absolute z-30 w-[min(25rem,calc(100vw-2rem))] rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-[0_12px_32px_rgba(0,0,0,0.16)]",
            placement === "above"
              ? "bottom-full left-0 mb-2 max-w-full"
              : "right-0 top-full mt-1",
          )}
        >
          <p className="px-2.5 pb-1.5 pt-2 text-[11px] font-medium uppercase leading-4 tracking-[0.08em] text-muted-foreground">
            {title}
          </p>
          <PermissionOptions value={value} onPick={pick} />
          {footer && (
            <div className="mt-1 flex items-center gap-2 border-t border-border px-2.5 pb-1.5 pt-2">
              {footer(() => setOpen(false))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The composer's chip with its picker for one chat. */
export function ChatPermissionMenu({
  value,
  defaultMode,
  onChange,
  onChangeDefault,
  disabled,
}: {
  value: PermissionMode;
  /** The account's default for new chats, named in the footer. */
  defaultMode: PermissionMode;
  onChange: (mode: PermissionMode) => void;
  onChangeDefault: () => void;
  disabled?: boolean;
}) {
  return (
    <PermissionPopover
      value={value}
      onChange={onChange}
      title="Permission for this chat"
      scope="chat"
      disabled={disabled}
      // Opens over the composer box, not the chip, so it fits a phone-width window.
      className="static"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Permission: ${modeName(value)}`}
          disabled={disabled}
          onClick={toggle}
          className="mr-1 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PermissionChip
            mode={value}
            caret
            className={cn(
              open &&
                (value === "auto"
                  ? "ring-2 ring-primary/15"
                  : value === "full"
                    ? "ring-2 ring-warning/20"
                    : "ring-2 ring-success/20"),
            )}
          />
        </button>
      )}
      footer={(close) => (
        <>
          <span className="min-w-0 flex-1 text-xs leading-4 text-muted-foreground">
            Only this chat. New chats start on {modeName(defaultMode)}.
          </span>
          <button
            type="button"
            onClick={() => {
              close();
              onChangeDefault();
            }}
            className="shrink-0 cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-primary outline-none transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            Change default
          </button>
        </>
      )}
    />
  );
}
