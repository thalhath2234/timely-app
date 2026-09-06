import type { LucideIcon } from "lucide-react";

export default function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Icon size={22} />
      </span>
      <p className="text-[15px] font-medium text-foreground">{title}</p>
      {description ? (
        <p className="text-sm text-muted-foreground text-pretty">{description}</p>
      ) : null}
    </div>
  );
}
