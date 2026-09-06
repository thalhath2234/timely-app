import { FileText, Star } from "lucide-react";
import type { Doc, Workspace } from "@/app/_types/types";
import ListCard from "../ListCard";
import { timeAgo } from "@/app/_lib/mobile/format";

export function EntityIcon({
  icon,
  fallback,
}: {
  icon: string | null;
  fallback: React.ReactNode;
}) {
  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-lg text-muted-foreground">
      {icon ? <span aria-hidden>{icon}</span> : fallback}
    </span>
  );
}

export default function DocCard({ doc, workspace }: { doc: Doc; workspace?: Workspace }) {
  const preview = doc.plainText.split("\n").find((l) => l.trim())?.slice(0, 80);
  return (
    <ListCard
      href={`/m/docs/${doc.id}`}
      leading={<EntityIcon icon={doc.icon} fallback={<FileText size={18} />} />}
      title={doc.title || "Untitled"}
      meta={
        <>
          {doc.isFavorite ? <Star size={11} className="fill-warning text-warning" /> : null}
          <span>{timeAgo(doc.updatedAt)}</span>
          {workspace ? <span>· {workspace.name}</span> : null}
          {preview ? <span className="w-full truncate">{preview}</span> : null}
        </>
      }
    />
  );
}
