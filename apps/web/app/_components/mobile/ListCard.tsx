import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

interface ListCardProps {
  href?: string;
  onClick?: () => void;
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  muted?: boolean;
}

/** Touch-sized row card shared by tasks, docs, sheets and settings lists. */
export default function ListCard({
  href,
  onClick,
  leading,
  title,
  meta,
  trailing,
  muted,
}: ListCardProps) {
  const content = (
    <>
      {leading ? <div className="flex shrink-0 items-center">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-[15px] font-medium leading-5 ${
            muted ? "text-muted-foreground line-through" : "text-card-foreground"
          }`}
        >
          {title}
        </p>
        {meta ? (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {meta}
          </div>
        ) : null}
      </div>
      {trailing ?? (
        <ChevronRight size={18} className="shrink-0 text-muted-foreground/60" />
      )}
    </>
  );

  const className =
    "flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors active:bg-muted";

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

export function SectionLabel({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-1 pt-4 pb-2">
      <h2 className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </h2>
      {trailing}
    </div>
  );
}
