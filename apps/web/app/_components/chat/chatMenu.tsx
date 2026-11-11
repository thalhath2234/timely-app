"use client";
import { useEffect, useRef, useState } from "react";
import { Check, MoreHorizontal } from "lucide-react";
import { menuItemClass, popoverSurface } from "@/app/_components/_ui/field";
import { PopoverView } from "@/app/_components/_ui/motion";
import { cn } from "@/app/utils/cn";

/**
 * The chat's own menu in its header. For now one switch: "Don't learn from
 * this chat" (plan 9b.2), which keeps the agent from saving skills or notes
 * from it and leaves it out of past-chat search.
 */
export default function ChatMenu({
  noLearning,
  sensitive,
  disabled,
  onNoLearning,
  className,
}: {
  noLearning: boolean;
  /** Private photo chats never teach Timely; the row says so. */
  sensitive: boolean;
  disabled?: boolean;
  onNoLearning: (next: boolean) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent | TouchEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    // Escape closes this menu, not the chat overlay it sits in.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  const checked = noLearning || sensitive;
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label="Chat options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className={className}
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open && (
        <PopoverView>
          <div
            role="menu"
            aria-label="Chat options"
            className={cn(
              popoverSurface,
              "absolute right-0 top-10 z-40 w-72 max-w-[calc(100vw-2rem)] p-1",
            )}
          >
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={checked}
              disabled={disabled || sensitive}
              onClick={() => {
                setOpen(false);
                onNoLearning(!noLearning);
              }}
              className={cn(
                menuItemClass,
                "items-start hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60",
              )}
            >
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                {checked && (
                  <Check aria-hidden className="size-4 text-primary" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  Don&apos;t learn from this chat
                </span>
                <span className="block text-xs leading-4 text-muted-foreground">
                  {sensitive
                    ? "Private photo chats never teach Timely."
                    : "Timely saves no skills or notes from it, and leaves it out when it searches your past chats."}
                </span>
              </span>
            </button>
          </div>
        </PopoverView>
      )}
    </div>
  );
}
