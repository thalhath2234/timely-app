"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Pipette } from "lucide-react";
import { cn } from "@/app/utils/cn";

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

/** Lets users select a color from the entity palette or enter a custom hex value. */
export default function ColorPicker({
  value,
  onChange,
  className,
  disabled,
  size = "md",
  "aria-label": ariaLabel,
}: ColorPickerProps) {
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PanelPos | null>(null);
  const [hexDraft, setHexDraft] = useState(value || "#889096");

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

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    function onReposition() {
      const height = panelRef.current?.offsetHeight ?? 260;
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
  }, [open, measure]);

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
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-lg border border-border bg-input/30 transition focus:border-ring focus:ring-1 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60",
          size === "sm" ? "size-7" : "h-8 w-10",
          className,
        )}
      >
        <span
          className={cn(
            "rounded-md ring-1 ring-foreground/15",
            size === "sm" ? "size-4" : "size-5",
          )}
          style={{ backgroundColor: current }}
        />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label={ariaLabel ?? "Choose color"}
            className="fixed z-[100] w-[220px] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl ring-1 ring-foreground/10"
            style={{
              top: pos.top,
              left: Math.max(8, pos.left),
              transform: pos.openUp ? "translateY(-100%)" : undefined,
            }}
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
                  className="min-w-0 flex-1 rounded-lg border border-border bg-input/30 px-2 py-1.5 font-mono text-xs uppercase outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/40"
                />
              </div>
            </label>
          </div>,
          document.body,
        )}
    </>
  );
}
