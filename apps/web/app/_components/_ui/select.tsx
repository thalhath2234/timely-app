"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/app/utils/cn";
import { PopoverView, useClientGate, useViewOpen } from "@/app/_components/_ui/motion";
import { controlClass, menuItemClass, popoverSurface, type ControlSize } from "@/app/_components/_ui/field";
import { propertyChipClass } from "@/app/_components/_ui/propertyChip";

export type SelectOption = {
  value: string;
  label: string;
  color?: string;
  /** Drawn before the label in the menu (a callout kind's icon). */
  icon?: ReactNode;
  disabled?: boolean;
  /** Options sharing a group are listed under that heading, in the order given. */
  group?: string;
};

type SelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Trigger height: sm 28px, md 32px, lg 36px (same scale as Input and Button). */
  size?: ControlSize;
  /**
   * "bare" drops the box, for a value inside a property row. "inline" sizes
   * to its label and takes the surrounding text colour, for a picker inside
   * running content (a doc callout's kind, a code block's language). "chip"
   * is a property chip in a create form: dashed while nothing (or the ""
   * option) is picked, the option's colour dot or `icon` before the label.
   */
  variant?: "default" | "bare" | "inline" | "chip";
  /** Chip only: drawn before the label when the option has no colour or icon. */
  icon?: ReactNode;
  /** Chip only: tint the chip with this colour (High or Urgent priority). */
  tint?: string;
  /** Chip only: accent fill, for the kind switcher in a create form's header. */
  active?: boolean;
  /** Adds a filter box at the top of the menu, for long lists (timezones). */
  searchable?: boolean;
  "aria-label"?: string;
};

type PanelPos = { top: number; left: number; width: number; openUp: boolean };

const bareBase =
  "rounded-md text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50";
const bareTrigger: Record<ControlSize, string> = {
  sm: `${bareBase} h-7 text-xs`,
  md: `${bareBase} h-8 text-sm`,
  lg: `${bareBase} h-9 text-sm`,
};
const inlineTrigger =
  "inline-flex h-6 max-w-full cursor-pointer items-center gap-1 rounded-md px-1.5 text-left text-inherit outline-none transition-colors hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring/30 aria-expanded:bg-foreground/[0.06] disabled:cursor-default disabled:hover:bg-transparent";

export default function Select({
  value,
  onChange,
  options,
  placeholder = "Select…",
  className,
  disabled,
  size = "md",
  variant = "default",
  searchable = false,
  icon,
  tint,
  active,
  "aria-label": ariaLabel,
}: SelectProps) {
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useViewOpen();
  const [pos, setPos] = useState<PanelPos | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [query, setQuery] = useState("");
  const mounted = useClientGate();

  const selected = options.find((option) => option.value === value);
  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      needle
        ? options.filter((option) =>
            `${option.label} ${option.value} ${option.group ?? ""}`.toLowerCase().includes(needle),
          )
        : options,
    [options, needle],
  );
  const enabledOptions = useMemo(() => visible.filter((option) => !option.disabled), [visible]);

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
    setQuery("");
    setPos(measure(searchable ? 300 : 240));
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

      // In a searchable menu the space bar types into the filter box.
      if (event.key === "Enter" || (event.key === " " && !searchable)) {
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
  }, [open, activeIndex, enabledOptions, onChange, measure, setOpen, searchable]);

  // Keep the highlighted row visible while moving through a long list.
  useEffect(() => {
    if (!open) return;
    panelRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, pos]);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const menu =
    mounted &&
    createPortal(
      open && pos ? (
        <PopoverView>
          <div
            className="fixed z-[100]"
            style={{
              top: pos.top,
              left: pos.left,
              width: Math.max(pos.width, variant === "chip" ? 200 : 160),
              transform: pos.openUp ? "translateY(-100%)" : undefined,
            }}
          >
            <div
              ref={panelRef}
              data-select-portal="true"
              className={cn(popoverSurface, "flex flex-col p-1")}
              onMouseDown={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              onTouchStart={(event) => event.stopPropagation()}
            >
              {searchable ? (
                <div className="relative mb-1 shrink-0">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setActiveIndex(0);
                    }}
                    placeholder="Search…"
                    aria-label={`Search ${ariaLabel ?? "options"}`}
                    aria-controls={listId}
                    className="h-8 w-full rounded-md bg-muted/60 pl-7 pr-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  />
                </div>
              ) : null}
              <div
                id={listId}
                role="listbox"
                aria-label={ariaLabel ?? placeholder}
                className="max-h-60 overflow-y-auto"
              >
                {visible.length === 0 ? (
                  <p className="px-2 py-1.5 text-sm text-muted-foreground">
                    {needle ? "No matches" : "No options"}
                  </p>
                ) : (
                  visible.map((option, index) => {
                    const enabledIndex = enabledOptions.findIndex(
                      (item) => item.value === option.value,
                    );
                    const active = enabledIndex === activeIndex;
                    const isSelected = option.value === value;
                    const heading =
                      option.group && option.group !== visible[index - 1]?.group ? option.group : null;

                    return (
                      <div key={option.value || "__empty"} role="presentation">
                        {heading ? (
                          <p className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                            {heading}
                          </p>
                        ) : null}
                        <button
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          data-active={active || undefined}
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
                            menuItemClass,
                            option.disabled && "cursor-not-allowed opacity-50",
                            !option.disabled &&
                              (active || isSelected
                                ? "bg-accent text-accent-foreground"
                                : "hover:bg-muted/70"),
                          )}
                        >
                          {option.icon ? (
                            <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
                              {option.icon}
                            </span>
                          ) : option.color ? (
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
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </PopoverView>
      ) : null,
      document.body,
    );

  if (variant === "chip") {
    const empty = !selected || selected.value === "";
    return (
      <>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={ariaLabel ? `${ariaLabel}, ${selected?.label ?? placeholder}` : undefined}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => (open ? setOpen(false) : openMenu())}
          className={propertyChipClass({ empty: empty && !active, active, className })}
          style={tint && !empty ? { backgroundColor: `${tint}1f` } : undefined}
        >
          {selected?.color && !empty ? (
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: selected.color }} />
          ) : (
            (!empty && selected?.icon) || icon
          )}
          <span className="truncate">{empty ? placeholder : selected?.label}</span>
          {active ? <ChevronDown aria-hidden className={cn("transition-transform", open && "rotate-180")} /> : null}
        </button>
        {menu}
      </>
    );
  }

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
          variant === "inline"
            ? inlineTrigger
            : cn(
                "flex w-full items-center justify-between gap-2 text-left",
                variant === "bare" ? bareTrigger[size] : controlClass(size),
              ),
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
        {variant === "inline" && disabled ? null : (
          <ChevronDown
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 transition-transform",
              variant === "inline" ? "opacity-70" : "text-muted-foreground",
              open && "rotate-180",
            )}
          />
        )}
      </button>

      {menu}
    </>
  );
}
