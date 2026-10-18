import type { ReactNode } from "react";
import { cn } from "@/app/utils/cn";

/**
 * The header at the top of every app page (Today, Inbox, Projects, Settings,
 * ...): one title size, one padding, actions on the right in Button md.
 * Spec: docs/design-system.md#page-header.
 */
export default function PageHeader({
  title,
  description,
  badge,
  actions,
  children,
  bordered = false,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Small count or status shown after the title. */
  badge?: ReactNode;
  /** Buttons on the right; the main one last. */
  actions?: ReactNode;
  /** Extra rows under the title (a capture field, a tip, tabs). */
  children?: ReactNode;
  /** A rule under the header, for pages whose body scrolls on its own. */
  bordered?: boolean;
  className?: string;
}) {
  return (
    <header className={cn("shrink-0 px-6 pb-4 pt-5", bordered && "border-b border-border", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="flex min-h-8 items-center gap-2.5">
            <h1 className="truncate text-[26px] font-semibold leading-8 tracking-[-0.02em] text-foreground">{title}</h1>
            {badge}
          </div>
          {description ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}

/** The small pill after a page title ("3 unreviewed", "12 tasks"). */
export function PageBadge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "primary" }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full px-2 text-xs font-medium tabular-nums",
        tone === "primary" ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
