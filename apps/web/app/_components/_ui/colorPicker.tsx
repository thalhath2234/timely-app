"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Pipette } from "lucide-react";
import { cn } from "@/app/utils/cn";
import { propertyChipClass } from "@/app/_components/_ui/propertyChip";
import { rowValueClass } from "@/app/_components/_ui/groupedList";
import { PopoverView, useClientGate, useViewOpen } from "@/app/_components/_ui/motion";
import { controlClass } from "@/app/_components/_ui/field";

const PRESET_COLORS = [
  "#889096",
  "#6E7C87",
  "#E5484D",
  "#E54D2E",
  "#F76808",
  "#FFB224",
  "#F5D90A",
  "#99D52A",
  "#30A66D",
  "#12A594",
  "#00A2C7",
  "#0090FF",
  "#3E63DD",
  "#6E56CF",
  "#AB4ABA",
  "#E93D82",
];

type ColorPickerProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  /**
   * "chip": a property chip in a create form, the colour dot and `chipLabel`.
   * "dot": just the dot, for a colour inside a chip-shaped composer.
   * "row": the value of a grouped row, the dot and its hex code.
   */
  variant?: "swatch" | "chip" | "dot" | "row";
  chipLabel?: string;
  "aria-label"?: string;
};

type PanelPos = { top: number; left: number; openUp: boolean };

function normalizeHex(value: string): string | null {
  const trimmed = value.trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  if (/^#[0-9a-fA-F]{6}$/.test(withHash)) return withHash.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(withHash)) {
    const [, r, g, b] = withHash;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return null;
}

export default function ColorPicker({
  value,
  onChange,
  className,
  disabled,
  size = "md",
  variant = "swatch",
  chipLabel = "Colour",
  "aria-label": ariaLabel,
}: ColorPickerProps) {
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useViewOpen();
  const [pos, setPos] = useState<PanelPos | null>(null);
  const [hexDraft, setHexDraft] = useState(value || "#889096");
  const mounted = useClientGate();

  const current = normalizeHex(value) ?? "#889096";

  const measure = useCallback((panelHeight = 260): PanelPos | null => {
    const trigger = triggerRef.current;
    if (!trigger) return null;

    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < panelHeight + 8 && rect.top > spaceBelow;

    return {
      top: openUp ? rect.top - 4 : rect.bottom + 4,
      left: Math.min(rect.left, window.innerWidth - 240),
      openUp,
    };
  }, []);

  const openPanel = () => {
    if (disabled) return;
    setHexDraft(current);
    setPos(measure());
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;

    const refine = () => {
      const height = panelRef.current?.offsetHeight ?? 260;
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

    // Capture phase + stopPropagation, like DatePicker: Escape closes only
    // this menu, not the dialog it sits in.
    function onEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }

    function onReposition() {
      const height = panelRef.current?.offsetHeight ?? 260;
      setPos(measure(height));
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onEscape, true);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onEscape, true);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, measure, setOpen]);

  const pick = (next: string) => {
    const normalized = normalizeHex(next);
    if (!normalized) return;
    onChange(normalized);
    setHexDraft(normalized);
  };

  const commitHex = () => {
    const normalized = normalizeHex(hexDraft);
    if (!normalized) {
      setHexDraft(current);
      return;
    }
    onChange(normalized);
    setHexDraft(normalized);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={ariaLabel ?? "Choose color"}
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={
          variant === "chip"
            ? propertyChipClass({ className })
            : variant === "row"
              ? cn(rowValueClass, className)
              : variant === "dot"
              ? cn(
                  "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-[8px] outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 aria-expanded:bg-muted disabled:cursor-not-allowed disabled:opacity-60",
                  className,
                )
              : cn(
                "inline-flex shrink-0 items-center justify-center rounded-md border border-input bg-card shadow-xs transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60",
                size === "sm" ? "size-7" : "h-8 w-10",
                className,
              )
        }
      >
        <span
          className={cn(
            "ring-1 ring-foreground/15",
            variant === "chip" || variant === "dot" || variant === "row" ? "size-2.5 rounded-full" : cn("rounded-md", size === "sm" ? "size-4" : "size-5"),
          )}
          style={{ backgroundColor: current }}
        />
        {variant === "chip" ? <span className="truncate">{chipLabel}</span> : null}
        {variant === "row" ? <span className="font-mono text-xs uppercase">{current}</span> : null}
      </button>

      {mounted &&
        createPortal(
          open && pos ? (
            <PopoverView>
              <div
                className="fixed z-[100]"
                style={{
                  top: pos.top,
                  left: Math.max(8, pos.left),
                  transform: pos.openUp ? "translateY(-100%)" : undefined,
                }}
              >
                <div
                  ref={panelRef}
                  id={panelId}
                  role="dialog"
                  aria-label={ariaLabel ?? "Choose color"}
                  className="w-[220px] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl ring-1 ring-foreground/10"
                >
            <div className="mb-3 flex items-center gap-2">
              <span
                className="size-8 shrink-0 rounded-lg ring-1 ring-foreground/15"
                style={{ backgroundColor: current }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Selected</p>
                <p className="truncate font-mono text-sm uppercase">{current}</p>
              </div>
            </div>

            <div className="mb-3 grid grid-cols-8 gap-1.5">
              {PRESET_COLORS.map((preset) => {
                const selected = current.toUpperCase() === preset.toUpperCase();
                return (
                  <button
                    key={preset}
                    type="button"
                    aria-label={preset}
                    onClick={() => pick(preset)}
                    className={cn(
                      "relative flex size-5 items-center justify-center rounded-md ring-1 ring-foreground/10 transition hover:scale-110",
                      selected && "ring-2 ring-ring",
                    )}
                    style={{ backgroundColor: preset }}
                  >
                    {selected && (
                      <Check
                        className="size-3 drop-shadow"
                        style={{
                          color:
                            parseInt(preset.slice(1, 3), 16) > 160
                              ? "#111"
                              : "#fff",
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">
                Custom hex
              </span>
              <div className="flex items-center gap-1.5">
                <span className="flex size-8 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground">
                  <Pipette className="size-3.5" />
                </span>
                <input
                  value={hexDraft}
                  onChange={(event) => setHexDraft(event.target.value)}
                  onBlur={commitHex}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitHex();
                    }
                  }}
                  spellCheck={false}
                  placeholder="#889096"
                  className={controlClass("sm", "min-w-0 flex-1 font-mono uppercase")}
                />
              </div>
            </label>
                </div>
              </div>
            </PopoverView>
          ) : null,
          document.body,
        )}
    </>
  );
}
