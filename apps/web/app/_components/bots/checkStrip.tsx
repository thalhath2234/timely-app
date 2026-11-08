import {
  stripLegend,
  stripMarks,
  stripSummary,
  type StripMark,
} from "@timely/contract/bots";
import { cn } from "@/app/utils/cn";

// "No change" is a short grey bar at 3:1 against the card; the shape carries
// the meaning as well as the colour: changed is hollow, told you and failed
// are full height, offline is a low dot.
const GREY = "color-mix(in srgb, var(--muted-foreground) 72%, var(--card))";

const SIZES = {
  sm: { box: "h-4 gap-0.5", w: 4, n: 8, c: 13, full: 16, o: 4, ring: 1.25 },
  big: {
    box: "h-[22px] gap-[3px]",
    w: 6,
    n: 11,
    c: 18,
    full: 22,
    o: 5,
    ring: 1.5,
  },
} as const;

function Mark({ mark, size }: { mark: StripMark; size: keyof typeof SIZES }) {
  const s = SIZES[size];
  const style =
    mark === "c"
      ? { height: s.c, boxShadow: `inset 0 0 0 ${s.ring}px var(--primary)` }
      : mark === "f"
        ? { height: s.full, background: "var(--primary)" }
        : mark === "x"
          ? { height: s.full, background: "var(--destructive)" }
          : mark === "o"
            ? { height: s.o, background: GREY, borderRadius: 2 }
            : { height: s.n, background: GREY };
  return (
    <i
      className="block shrink-0 rounded-[1.5px]"
      style={{ width: s.w, ...style }}
    />
  );
}

/**
 * One mark per check, oldest on the left: the board cards' row of checks and
 * the rail's big strip. `count` keeps only the newest marks.
 */
export function CheckStrip({
  marks,
  size = "sm",
  count,
  legend,
  className,
}: {
  marks: string | null | undefined;
  size?: "sm" | "big";
  count?: number;
  legend?: boolean;
  className?: string;
}) {
  const shown = stripMarks(marks ?? "", count);
  if (shown.length === 0 && !legend) return null;
  const strip = (
    <span
      role="img"
      aria-label={stripSummary(shown.join(""))}
      className={cn(
        "inline-flex shrink-0 items-end",
        SIZES[size].box,
        className,
      )}
    >
      {shown.map((mark, index) => (
        <Mark key={index} mark={mark} size={size} />
      ))}
    </span>
  );
  if (!legend) return strip;
  return (
    <div className="flex flex-col gap-3">
      {shown.length ? strip : null}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {stripLegend().map(({ mark, label }) => (
          <span key={mark} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-flex h-4 items-end">
              <Mark mark={mark} size="sm" />
            </span>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
