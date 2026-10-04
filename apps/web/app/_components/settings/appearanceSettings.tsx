"use client";

import ColorPicker from "@/app/_components/_ui/colorPicker";
import { usePreferences } from "@/app/_components/_layout/clientRuntime";
import { cn } from "@/app/utils/cn";
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT_HEX,
  normalizeHex,
  type ThemePreference,
} from "@/app/utils/theme";

export default function AppearanceSettings() {
  const {
    theme,
    setTheme,
    accent,
    setAccent,
    sidebarAutoHide,
    setSidebarAutoHide,
    reducedMotion,
    setReducedMotion,
  } = usePreferences();
  const accentSwatch = accent === "default" ? DEFAULT_ACCENT_HEX : accent;

  return (
    <div className="flex max-w-3xl flex-col gap-10">
      <section>
        <h2 className="text-base font-semibold">Appearance</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Theme and accent follow this account on web and mobile.
        </p>
      </section>

      <section>
        <h3 className="text-sm font-semibold">Color mode</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Use your device setting or choose a light or dark theme.
        </p>
        <div className="mt-3 flex gap-2" role="group" aria-label="Color theme">
          {(["system", "light", "dark"] as const).map((option) => (
            <ThemeOption
              key={option}
              option={option}
              selected={theme === option}
              onSelect={() => setTheme(option)}
            />
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold">Accent color</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Buttons, highlights, and focus rings follow this color.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Accent color">
          {ACCENT_PRESETS.map((preset) => {
            const selected = accent === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                aria-label={preset.label}
                aria-pressed={selected}
                title={preset.label}
                onClick={() => setAccent(preset.id)}
                className={cn(
                  "size-8 rounded-full ring-1 ring-foreground/15 transition hover:scale-105",
                  selected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
                )}
                style={{ backgroundColor: preset.hex }}
              />
            );
          })}
          <ColorPicker
            value={accentSwatch}
            onChange={(value) => {
              const next = normalizeHex(value);
              if (next) setAccent(next);
            }}
            aria-label="Custom accent color"
          />
        </div>
        {accent !== "default" ? (
          <button
            type="button"
            onClick={() => setAccent("default")}
            className="mt-3 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Reset to default violet
          </button>
        ) : null}
        <div className="mt-4 overflow-hidden rounded-xl border border-border">
          <div className="flex h-14">
            <div className="flex flex-1 items-end p-2 text-[11px] font-medium text-primary-foreground" style={{ backgroundColor: "var(--primary)" }}>
              Primary
            </div>
            <div className="flex flex-1 items-end bg-accent p-2 text-[11px] font-medium text-accent-foreground">
              Accent
            </div>
            <div className="flex flex-1 items-end bg-background p-2 text-[11px] font-medium text-foreground">
              Surface
            </div>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold">Motion</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Applies to this device. Your system&apos;s reduced-motion setting is always honored.
        </p>
        <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-border px-3 py-3">
          <input
            type="checkbox"
            autoComplete="off"
            className="mt-0.5 size-4 accent-primary"
            checked={reducedMotion}
            onChange={(event) => setReducedMotion(event.target.checked)}
          />
          <span>
            <span className="block text-sm font-medium">Reduce motion</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Open dialogs, menus, and pages instantly instead of animating them.
            </span>
          </span>
        </label>
      </section>

      <section>
        <h3 className="text-sm font-semibold">Sidebar</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Keep more room for work by hiding the navigation rail until you need it.
        </p>
        <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-border px-3 py-3">
          <input
            type="checkbox"
            autoComplete="off"
            className="mt-0.5 size-4 accent-primary"
            checked={sidebarAutoHide}
            onChange={(event) => setSidebarAutoHide(event.target.checked)}
          />
          <span>
            <span className="block text-sm font-medium">Auto-hide sidebar</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Hide the rail until the pointer is at the left edge of the window.
            </span>
          </span>
        </label>
      </section>
    </div>
  );
}

function ThemeOption({
  option,
  selected,
  onSelect,
}: {
  option: ThemePreference;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "min-w-20 rounded-lg border px-3 py-2 text-sm",
        selected
          ? "border-primary/40 bg-primary/12 text-foreground"
          : "border-border hover:bg-accent",
      )}
    >
      {option === "system" ? "System" : option === "light" ? "Light" : "Dark"}
    </button>
  );
}
