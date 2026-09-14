import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/app/utils/cn";
import { chipStyle } from "@/app/utils/entityColor";

export default function ColorChip({
  color,
  children,
  className,
  dot = true,
}: {
  color?: string | null;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  const style: CSSProperties = chipStyle(color);
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        className,
      )}
      style={style}
    >
      {dot ? (
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color || "currentColor" }}
        />
      ) : null}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}
