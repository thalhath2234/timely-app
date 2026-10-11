import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/app/utils/cn";

/** Fades and lifts into place on scroll (see Shell); fully visible without JS. */
export function Rv({
  children,
  className,
  delay = 0,
  as: Tag = "div",
  id,
  leader = false,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "li" | "section" | "header" | "figure" | "p" | "ol" | "ul" | "aside";
  id?: string;
  /** Also draw this block's dotted leaders out from the left. */
  leader?: boolean;
}) {
  return (
    <Tag
      id={id}
      className={cn("d2-rv", leader && "d2-rv-leader", className)}
      style={delay ? ({ "--rv-delay": `${delay}ms` } as CSSProperties) : undefined}
    >
      {children}
    </Tag>
  );
}

/** Standard page gutter and measure. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[1240px] px-4 sm:px-8", className)}>{children}</div>;
}

const WORDS = ["", "one", "two", "three", "four", "five", "six", "seven"];

/**
 * A chapter opener: the numeral in the margin, a running head, the title and
 * a short standfirst, over a double rule.
 */
export function ChapterHead({
  n,
  head,
  title,
  lead,
  headingId,
}: {
  n: number;
  head: string;
  title: ReactNode;
  lead?: ReactNode;
  headingId: string;
}) {
  return (
    <header className="d2-double grid gap-x-10 gap-y-2 pb-10 lg:grid-cols-[180px_minmax(0,1fr)]">
      <Rv className="flex items-baseline gap-3 lg:block">
        <span className="d2-kicker block">Chapter {WORDS[n]}</span>
        <span aria-hidden className="d2-serif block text-[4.5rem] leading-[0.9] font-light italic text-[var(--verm-2)] lg:mt-2 lg:text-[7.5rem]">
          {n}
        </span>
      </Rv>
      <div className="min-w-0">
        <Rv className="d2-kicker lg:pt-2">{head}</Rv>
        <Rv delay={60}>
          <h2 id={headingId} className="d2-display mt-3 max-w-[18ch] text-[2.5rem] text-balance sm:text-[3.4rem] lg:text-[4.2rem]">
            <span className="sr-only">Chapter {n}: </span>
            {title}
          </h2>
        </Rv>
        {lead ? (
          <Rv delay={120}>
            <p className="d2-soft mt-6 max-w-[60ch] text-[1.05rem] leading-relaxed sm:text-lg">{lead}</p>
          </Rv>
        ) : null}
      </div>
    </header>
  );
}

/** A superscript footnote mark that jumps to its note. */
export function Fn({ n }: { n: number }) {
  return (
    <sup>
      <a id={`fnref-${n}`} href={`#fn-${n}`} className="d2-fn" aria-label={`Note ${n}`}>
        {n}
      </a>
    </sup>
  );
}

/** The notes at the foot of a chapter, plus the running foot and folio. */
export function Footnotes({
  notes,
  running,
  folio,
}: {
  notes: { n: number; text: ReactNode }[];
  running: string;
  folio: number;
}) {
  return (
    <footer className="mt-16 lg:ml-[220px]">
      {notes.length ? (
        <aside aria-label="Notes" className="max-w-[72ch] border-t border-[var(--rule-2)] pt-4">
          <ol className="space-y-2 text-sm leading-relaxed text-[var(--ink-2)]">
            {notes.map((note) => (
              <li key={note.n} id={`fn-${note.n}`} className="flex gap-3">
                <span className="d2-mono w-4 shrink-0 text-xs leading-[1.6rem] text-[var(--verm-2)]">{note.n}</span>
                <span>
                  {note.text}{" "}
                  <a href={`#fnref-${note.n}`} className="d2-faint hover:text-[var(--ink)]" aria-label={`Back to note ${note.n} in the text`}>
                    ↩
                  </a>
                </span>
              </li>
            ))}
          </ol>
        </aside>
      ) : null}
      <p className="d2-kicker mt-10 flex items-center justify-between gap-4" aria-hidden>
        <span>Timely · {running}</span>
        <span className="d2-serif text-base tracking-normal normal-case italic">— {folio} —</span>
      </p>
    </footer>
  );
}

/** A figure caption in the manual's style: "Fig. 1.2 — …". */
export function Caption({ fig, children, className }: { fig: string; children: ReactNode; className?: string }) {
  return (
    <figcaption className={cn("mt-3 flex gap-2 text-sm leading-snug text-[var(--ink-2)]", className)}>
      <span className="d2-mono shrink-0 text-xs leading-5 text-[var(--verm-2)]">Fig. {fig}</span>
      <span className="d2-serif italic">{children}</span>
    </figcaption>
  );
}
