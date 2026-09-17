"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/app/utils/cn";
import { PopoverView, useClientGate, useViewOpen } from "@/app/_components/_ui/motion";

export type SelectOption = {
  value: string;
  label: string;
  color?: string;
  disabled?: boolean;
};

type SelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Visual size of the trigger. */
  size?: "sm" | "md";
  "aria-label"?: string;
};

type PanelPos = { top: number; left: number; width: number; openUp: boolean };

const triggerBase =
  "flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-input/30 text-left text-foreground outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60";

export default function Select({
  value,
  onChange,
  options,
  placeholder = "Select…",
  className,
  disabled,
  size = "md",
  "aria-label": ariaLabel,
}: SelectProps) {
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useViewOpen();
  const [pos, setPos] = useState<PanelPos | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const mounted = useClientGate();

  const selected = options.find((option) => option.value === value);
  const enabledOptions = options.filter((option) => !option.disabled);

  const measure = useCallback((panelHeight = 240): PanelPos | null => {
    const trigger = triggerRef.current;
    if (!trigger) return null;

    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < panelHeight + 8 && rect.top > spaceBelow;

    return {
      top: openUp ? rect.top - 4 : rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      openUp,
    };
  }, []);

  const openMenu = () => {
    if (disabled) return;
    const selectedIndex = enabledOptions.findIndex(
      (option) => option.value === value,
    );
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setPos(measure());
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;

    const refine = () => {
      const height = panelRef.current?.offsetHeight ?? 240;
      setPos(measure(height));
    };
    const frame = window.requestAnimationFrame(refine);

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => {
          if (enabledOptions.length === 0) return 0;
          const delta = event.key === "ArrowDown" ? 1 : -1;
          return (
            (current + delta + enabledOptions.length) % enabledOptions.length
          );
        });
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const option = enabledOptions[activeIndex];
        if (option) {
          onChange(option.value);
          setOpen(false);
          triggerRef.current?.focus();
        }
      }
    }

    function onReposition() {
      const height = panelRef.current?.offsetHeight ?? 240;
      setPos(measure(height));
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, activeIndex, enabledOptions, onChange, measure]);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className={cn(
          triggerBase,
          size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm",
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected?.color && (
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: selected.color }}
            />
          )}
          <span
            className={cn("truncate", !selected && "text-muted-foreground")}
          >
            {selected?.label ?? placeholder}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {mounted &&
        createPortal(
          open && pos ? (
            <PopoverView>
              <div
                className="fixed z-[100]"
                style={{
                  top: pos.top,
                  left: pos.left,
                  width: Math.max(pos.width, 160),
                  transform: pos.openUp ? "translateY(-100%)" : undefined,
                }}
              >
                <div
                  ref={panelRef}
                  id={listId}
                  role="listbox"
                  data-select-portal="true"
                  aria-label={ariaLabel ?? placeholder}
                  className="max-h-60 overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl ring-1 ring-foreground/10"
                  onMouseDown={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                  onTouchStart={(event) => event.stopPropagation()}
                >
            {options.length === 0 ? (
              <p className="px-2 py-1.5 text-sm text-muted-foreground">
                No options
              </p>
            ) : (
              options.map((option) => {
                const enabledIndex = enabledOptions.findIndex(
                  (item) => item.value === option.value,
                );
                const active = enabledIndex === activeIndex;
                const isSelected = option.value === value;

                return (
                  <button
                    key={option.value || "__empty"}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={option.disabled}
                    onMouseEnter={() => {
                      if (!option.disabled && enabledIndex >= 0) {
                        setActiveIndex(enabledIndex);
                      }
                    }}
                    onClick={() => {
                      if (!option.disabled) pick(option.value);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                      option.disabled && "cursor-not-allowed opacity-50",
                      !option.disabled &&
                        (active || isSelected
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-muted/70"),
                    )}
                  >
                    {option.color ? (
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: option.color }}
                      />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">
                      {option.label}
                    </span>
                    {isSelected && (
                      <Check className="size-3.5 shrink-0 text-primary" />
                    )}
                  </button>
                );
              })
            )}
                </div>
              </div>
            </PopoverView>
          ) : null,
          document.body,
        )}
    </>
  );
}
