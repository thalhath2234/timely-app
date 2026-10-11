import type { CSSProperties } from "react";
import { Search } from "lucide-react";
import { PALETTE } from "@/app/_components/variations/content";

/* Small graphics for the feature cards. Each is CSS-only, loops while
   motion is allowed and rests in its finished state otherwise. */

const vars = (c: string, extra?: Record<string, string>) => ({ "--c": c, ...extra }) as CSSProperties;

/** Three days of a week; a work block moves into the gap after a meeting lands. */
export function ScheduleGraphic() {
  return (
    <div className="v5-g" aria-hidden>
      <div className="absolute inset-0 grid grid-cols-3 divide-x divide-[var(--v-line)]">
        {[0, 1, 2].map((day) => (
          <div key={day} className="relative">
            {[1, 2, 3, 4].map((h) => (
              <span key={h} className="absolute inset-x-0 border-t border-[var(--v-line)]" style={{ top: `${h * 22}%` }} />
            ))}
          </div>
        ))}
      </div>
      <span className="v5-g-block" style={{ ...vars(PALETTE.blue), left: "35.5%", width: "29%", top: "22%", height: "26%" }} />
      <span className="v5-g-block" style={{ ...vars(PALETTE.violet), left: "2.5%", width: "29%", top: "10%", height: "30%" }} />
      <span
        className="v5-g-block v5-g-move"
        style={{ ...vars(PALETTE.violet, { "--from-x": "-110%", "--from-y": "-100%" }), left: "35.5%", width: "29%", top: "52%", height: "38%" }}
      />
      <span className="v5-g-block" style={{ ...vars(PALETTE.green), left: "68.5%", width: "29%", top: "22%", height: "20%" }} />
    </div>
  );
}

/** A doc page beside a sheet with a SUM row. */
export function DocsGraphic() {
  const widths = [78, 92, 64, 88, 40];
  return (
    <div className="v5-g grid grid-cols-[1.1fr_1fr] gap-3 p-3" aria-hidden>
      <div className="rounded-md border border-[var(--v-line)] bg-[var(--v-surface)] p-2.5">
        <span className="block h-2 w-1/2 rounded-sm bg-[var(--v-ink)]/80" />
        <div className="mt-2.5 space-y-1.5">
          {widths.map((width, index) => (
            <span
              key={index}
              className={index === widths.length - 1 ? "v5-g-grow block h-1.5 rounded-sm bg-[var(--v-soft)]/50" : "block h-1.5 rounded-sm bg-[var(--v-soft)]/50"}
              style={{ width: `${width}%` }}
            />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-px overflow-hidden rounded-md border border-[var(--v-line)] bg-[var(--v-line)] text-[0.6rem] tabular-nums">
        {[
          ["Venue", "1,200"],
          ["Printing", "340"],
          ["Snacks", "180"],
        ].map(([item, cost]) => (
          <SheetRow key={item} item={item} cost={cost} />
        ))}
        <span className="bg-[var(--v-surface)] px-1.5 py-1 font-mono text-[var(--v-primary)]">=SUM</span>
        <span className="bg-[var(--v-surface)] px-1.5 py-1 text-right font-semibold text-[var(--v-primary)]">1,720</span>
      </div>
    </div>
  );
}

function SheetRow({ item, cost }: { item: string; cost: string }) {
  return (
    <>
      <span className="bg-[var(--v-surface)] px-1.5 py-1 text-[var(--v-soft)]">{item}</span>
      <span className="bg-[var(--v-surface)] px-1.5 py-1 text-right text-[var(--v-ink)]">{cost}</span>
    </>
  );
}

/** The search box with results of four kinds. */
export function SearchGraphic() {
  const rows = [
    { label: "Write the launch brief", kind: "Task", color: PALETTE.violet },
    { label: "Launch plan", kind: "Doc", color: PALETTE.amber },
    { label: "Launch budget", kind: "Sheet", color: PALETTE.green },
  ];
  return (
    <div className="v5-g p-3" aria-hidden>
      <div className="flex h-7 items-center gap-2 rounded-md border border-[var(--v-primary)]/60 bg-[var(--v-surface)] px-2.5 text-xs">
        <Search className="size-3.5 text-[var(--v-soft)]" />
        <span>
          launch
          <span className="v5-caret" />
        </span>
      </div>
      <ul className="mt-1.5 space-y-0.5 text-xs">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-2 rounded-md px-1.5 py-0.5 first:bg-[var(--v-raised)]">
            <span className="size-1.5 rounded-full" style={{ background: row.color }} />
            <span className="truncate">{row.label}</span>
            <span className="ml-auto text-[var(--v-faint)]">{row.kind}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A mini dashboard; one card is dragged to a new slot. */
export function DashboardGraphic() {
  const slots: Array<{ left: string; top: string; width: string; height: string; c?: string; move?: boolean }> = [
    { left: "4%", top: "8%", width: "44%", height: "40%", c: PALETTE.primary },
    { left: "52%", top: "8%", width: "20%", height: "40%", c: PALETTE.amber },
    { left: "76%", top: "8%", width: "20%", height: "40%", c: PALETTE.green },
    { left: "4%", top: "54%", width: "20%", height: "38%", c: PALETTE.blue },
    { left: "28%", top: "54%", width: "44%", height: "38%", c: PALETTE.pink, move: true },
    { left: "76%", top: "54%", width: "20%", height: "38%", c: PALETTE.cyan },
  ];
  return (
    <div className="v5-g" aria-hidden>
      {slots.map((slot, index) => (
        <span
          key={index}
          className={slot.move ? "v5-g-lift absolute rounded-md border border-[var(--v-line-strong)] bg-[var(--v-surface)]" : "absolute rounded-md border border-[var(--v-line)] bg-[var(--v-surface)]"}
          style={{ left: slot.left, top: slot.top, width: slot.width, height: slot.height, ...(slot.move ? { "--from-x": "-50%", "--from-y": "-118%", zIndex: 2 } : {}) } as CSSProperties}
        >
          <span className="absolute top-1.5 left-1.5 h-1 w-1/2 rounded-sm bg-[var(--v-faint)]/60" />
          <span className="absolute bottom-1.5 left-1.5 h-1.5 w-[30%] rounded-sm" style={{ background: slot.c }} />
        </span>
      ))}
    </div>
  );
}

/** Three habits over a week; today's column fills in. */
export function HabitsGraphic() {
  const habits = [
    { name: "Run", color: PALETTE.green, done: [1, 1, 1, 1, 0, 0, 0] },
    { name: "Read", color: PALETTE.amber, done: [1, 0, 1, 1, 0, 0, 0] },
    { name: "Stretch", color: PALETTE.cyan, done: [1, 1, 1, 1, 0, 0, 0] },
  ];
  const today = 3;
  return (
    <div className="v5-g flex flex-col justify-center gap-2 px-4" aria-hidden>
      {habits.map((habit) => (
        <div key={habit.name} className="grid grid-cols-[3.25rem_repeat(7,1fr)] items-center gap-1 text-xs">
          <span className="text-[var(--v-soft)]">{habit.name}</span>
          {habit.done.map((on, index) => (
            <span
              key={index}
              className={index === today ? "v5-dot v5-g-fill mx-auto !size-3.5" : "v5-dot mx-auto !size-3.5"}
              data-on={index !== today && Boolean(on)}
              style={vars(habit.color)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** The same tasks as a board and as a Gantt chart. */
export function ViewsGraphic() {
  const columns = [
    { label: "Inbox", color: PALETTE.green, cards: 2 },
    { label: "Doing", color: PALETTE.blue, cards: 1 },
    { label: "Done", color: PALETTE.amber, cards: 3 },
  ];
  const bars = [
    { left: 0, width: 45, color: PALETTE.violet },
    { left: 30, width: 40, color: PALETTE.blue },
    { left: 55, width: 45, color: PALETTE.green },
  ];
  return (
    <div className="v5-g grid grid-cols-2 gap-3 p-3" aria-hidden>
      <div className="grid grid-cols-3 gap-1.5">
        {columns.map((column) => (
          <div key={column.label} className="rounded-md border-t-2 bg-[var(--v-surface)] p-1" style={{ borderColor: column.color }}>
            {Array.from({ length: column.cards }, (_, index) => (
              <span key={index} className="mb-1 block h-3 rounded-sm bg-[var(--v-raised)]" />
            ))}
          </div>
        ))}
      </div>
      <div className="relative flex flex-col justify-center gap-2">
        <span className="absolute inset-y-0 left-1/2 border-l border-dashed border-[var(--v-line-strong)]" />
        {bars.map((bar, index) => (
          <span
            key={index}
            className={index === 2 ? "v5-g-grow h-3 rounded-sm" : "h-3 rounded-sm"}
            style={{ marginLeft: `${bar.left}%`, width: `${bar.width}%`, background: bar.color }}
          />
        ))}
      </div>
    </div>
  );
}
