import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/app/utils/cn";

/**
 * A column header strip: the 3px stage-coloured rule, a dot, an uppercase
 * mono label and a count badge, like the app's kanban columns. Used both for
 * the board columns and for every section of the page.
 */
export function ColumnHead({
  color,
  label,
  count,
  icon,
  trailing,
  className,
  children,
}: {
  color: string;
  label: string;
  count?: number | string;
  icon?: ReactNode;
  /** Anything to put at the right end of the strip row (a link, a version). */
  trailing?: ReactNode;
  className?: string;
  /** The headline and intro under the strip, for section headers. */
  children?: ReactNode;
}) {
  return (
    <div className={cn("v3-colhead", className)} style={{ "--c": color } as CSSProperties}>
      <div className="v3-colhead-row">
        {icon ?? <span aria-hidden className="v3-dot" />}
        <span className="v3-mono">{label}</span>
        {count !== undefined ? <span className="v3-count">{count}</span> : null}
        {trailing ? <span className="ml-auto flex items-center gap-2">{trailing}</span> : null}
      </div>
      {children}
    </div>
  );
}

/** A section of the landing page laid out as one wide column. */
export function SectionColumn({
  id,
  color,
  label,
  count,
  title,
  intro,
  trailing,
  children,
}: {
  id: string;
  color: string;
  label: string;
  count: number | string;
  title: string;
  intro?: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="v3-section scroll-mt-20">
      <div className="v-container">
        <ColumnHead color={color} label={label} count={count} trailing={trailing}>
          <div className="mt-6 flex flex-col gap-4 md:mt-8 md:flex-row md:items-end md:justify-between md:gap-10">
            <h2 id={`${id}-title`} className="v3-display max-w-[14ch] text-[2.1rem] sm:text-[2.6rem] lg:text-[3.1rem]">
              {title}
            </h2>
            {intro ? <p className="max-w-md text-base leading-relaxed text-[var(--v-soft)] md:pb-1.5 md:text-right">{intro}</p> : null}
          </div>
        </ColumnHead>
        <div className="mt-7 md:mt-9">{children}</div>
      </div>
    </section>
  );
}
