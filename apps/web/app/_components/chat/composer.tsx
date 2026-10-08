"use client";
import { useRef, type RefObject } from "react";
import { ArrowUp, Check, Globe2, ImagePlus, Square, X } from "lucide-react";
import TimelyLogo, {
  LogoSpinner,
  SPINNER_LOOP_SECONDS,
} from "@/app/_components/_ui/timelyLogo";
import type { ChatContext, ChatImage } from "@/app/utils/api/chat";
import { cn } from "@/app/utils/cn";
import { chipIcon } from "./chatMeta";
import { PendingImages } from "./imageAttachments";
import ModelMenu, { type ModelChoice } from "./modelMenu";

export function ContextChips({
  chips,
  disabled,
  onRemove,
}: {
  chips: ChatContext[];
  disabled: boolean;
  onRemove: (index: number) => void;
}) {
  if (!chips.length) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Attached context">
      {chips.map((chip, i) => {
        const Icon = chipIcon(chip.kind);
        return (
          <span
            key={`${chip.kind}-${chip.value}`}
            title={chip.value}
            className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-primary/20 bg-primary/8 py-0.5 pl-2 text-xs text-primary"
          >
            <Icon className="size-3 shrink-0" />
            <span className="truncate">{chip.label}</span>
            <button
              type="button"
              disabled={disabled}
              aria-label={`Remove ${chip.label} context`}
              onClick={() => onRemove(i)}
              className="rounded-r-md p-1 hover:bg-primary/15 disabled:opacity-40"
            >
              <X className="size-3" />
            </button>
          </span>
        );
      })}
    </div>
  );
}

export default function Composer({
  inputRef,
  draft,
  setDraft,
  placeholder,
  chips,
  onRemoveChip,
  images,
  uploading,
  addFiles,
  removeImage,
  webSearch,
  sensitive,
  onToggleSearch,
  model,
  onChangeModel,
  busy,
  pending,
  onSend,
  onStop,
  hint,
  variant = "panel",
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: (value: string) => void;
  placeholder: string;
  chips: ChatContext[];
  onRemoveChip: (index: number) => void;
  images: ChatImage[];
  uploading: boolean;
  addFiles: (files: File[]) => void;
  removeImage: (id: string) => void;
  webSearch: boolean;
  sensitive: boolean;
  onToggleSearch: () => void;
  model: ModelChoice;
  onChangeModel: (next: ModelChoice) => void;
  busy: boolean;
  pending: boolean;
  onSend: () => void;
  onStop: () => void;
  hint: string;
  // "bar" is the floating quick prompt: no outer padding, the hint moves
  // inside the card, and menus open downward.
  variant?: "panel" | "bar";
}) {
  const bar = variant === "bar";
  const fileInput = useRef<HTMLInputElement>(null);
  const privateImages = sensitive || images.length > 0;
  const searchOn = webSearch && !privateImages;
  const canSend = (draft.trim() || images.length) && !pending && !uploading;
  return (
    <div className={cn("shrink-0", !bar && "px-4 pb-4 pt-1 md:px-8 md:pb-5")}>
      <div className="mx-auto max-w-3xl">
        <div
          className={cn(
            "rounded-2xl border border-border bg-card p-2.5 transition-[box-shadow,border-color] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/15",
            bar ? "shadow-2xl" : "shadow-sm",
          )}
        >
          <div className="px-1 pt-0.5">
            <ContextChips
              chips={chips}
              disabled={busy || pending}
              onRemove={onRemoveChip}
            />
            {!!images.length && (
              <PendingImages images={images} remove={removeImage} />
            )}
            {uploading && (
              <p
                role="status"
                className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"
              >
                <TimelyLogo
                  size={12}
                  animated
                  duration={SPINNER_LOOP_SECONDS}
                />
                Uploading image…
              </p>
            )}
          </div>
          <textarea
            ref={inputRef}
            aria-label="Message Timely"
            placeholder={placeholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length) {
                e.preventDefault();
                if (!busy && !pending) addFiles(files);
              }
            }}
            maxLength={16000}
            rows={2}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                onSend();
              }
            }}
            className="max-h-48 min-h-14 w-full resize-none bg-transparent px-1.5 py-1.5 text-sm leading-6 outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-0.5">
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png"
                multiple
                className="hidden"
                aria-label="Upload images"
                onChange={(e) => {
                  if (e.target.files) addFiles(Array.from(e.target.files));
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                aria-label="Attach images"
                title="Attach up to five JPEG or PNG photos"
                disabled={busy || pending || uploading || images.length >= 5}
                onClick={() => fileInput.current?.click()}
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              >
                <ImagePlus className="size-4" />
              </button>
              <button
                type="button"
                aria-pressed={searchOn}
                disabled={busy || pending || privateImages}
                onClick={onToggleSearch}
                title={
                  privateImages
                    ? "Web search is off for conversations with images"
                    : "Let Timely search the web when useful"
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors disabled:opacity-50",
                  searchOn
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Globe2 className="size-4" />
                {privateImages ? "Private image chat" : "Web search"}
                {searchOn && <Check className="size-3" />}
              </button>
              <ModelMenu
                value={model}
                onChange={onChangeModel}
                disabled={pending}
                placement={bar ? "down" : "up"}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden text-[11px] text-muted-foreground sm:block">
                <kbd className="font-sans">Enter</kbd> to send ·{" "}
                <kbd className="font-sans">Shift+Enter</kbd> for a new line
              </span>
              {busy ? (
                <button
                  type="button"
                  aria-label="Stop run"
                  disabled={pending}
                  onClick={onStop}
                  className="flex size-9 items-center justify-center rounded-lg border border-border bg-background text-foreground transition-colors hover:bg-muted"
                >
                  <Square className="size-3.5 fill-current" />
                </button>
              ) : (
                <button
                  type="button"
                  aria-label="Send message"
                  disabled={!canSend}
                  onClick={onSend}
                  className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm transition-opacity hover:bg-primary/90 disabled:opacity-30"
                >
                  {pending ? (
                    <LogoSpinner size={16} tone="mono" label="Sending" />
                  ) : (
                    <ArrowUp className="size-4" strokeWidth={2.5} />
                  )}
                </button>
              )}
            </div>
          </div>
          {bar && hint && (
            <p className="px-1.5 pt-1.5 text-[11px] text-muted-foreground">
              {hint}
            </p>
          )}
        </div>
        {!bar && (
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
