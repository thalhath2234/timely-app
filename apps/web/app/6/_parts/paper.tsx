import { cn } from "@/app/utils/cn";

export const NOTE = {
  yellow: "var(--n-yellow)",
  pink: "var(--n-pink)",
  green: "var(--n-green)",
  blue: "var(--n-blue)",
  orange: "var(--n-orange)",
  violet: "var(--n-violet)",
  cream: "var(--n-cream)",
} as const;

export type NoteColor = keyof typeof NOTE;

export function noteStyle(color: NoteColor, rotate = 0, extra?: React.CSSProperties): React.CSSProperties {
  return { ["--c" as string]: NOTE[color], transform: rotate ? `rotate(${rotate}deg)` : undefined, ...extra };
}

/** A strip of masking tape; position it with className or style. */
export function Tape({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden className={cn("d6-tape", className)} style={style} />;
}

/** Section opener: a small handwritten tab label, then the heading and a lead line. */
export function SectionHead({
  id,
  tab,
  color = "yellow",
  title,
  lead,
  className,
}: {
  id: string;
  tab: string;
  color?: NoteColor;
  title: React.ReactNode;
  lead?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("max-w-3xl", className)}>
      <p
        className="d6-note d6-hand inline-block px-3 pt-1 pb-0.5 text-[15px] font-bold"
        style={noteStyle(color, -2)}
      >
        {tab}
      </p>
      <h2 id={id} className="d6-display mt-5 text-[2.35rem] leading-[1.02] font-extrabold text-balance sm:text-6xl">
        {title}
      </h2>
      {lead ? <p className="d6-soft mt-5 max-w-2xl text-lg leading-relaxed text-pretty">{lead}</p> : null}
    </div>
  );
}
