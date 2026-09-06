import { Sheet as SheetIcon, Star } from "lucide-react";
import type { Sheet, Workspace } from "@/app/_types/types";
import ListCard from "../ListCard";
import { EntityIcon } from "../docs/DocCard";
import { timeAgo } from "@/app/_lib/mobile/format";

export default function SheetCard({ sheet, workspace }: { sheet: Sheet; workspace?: Workspace }) {
  return (
    <ListCard
      href={`/m/sheets/${sheet.id}`}
      leading={<EntityIcon icon={sheet.icon} fallback={<SheetIcon size={18} />} />}
      title={sheet.title || "Untitled"}
      meta={
        <>
          {sheet.isFavorite ? <Star size={11} className="fill-warning text-warning" /> : null}
          <span>
            {sheet.rows.length} rows · {sheet.columns.length} cols
          </span>
          <span>· {timeAgo(sheet.updatedAt)}</span>
          {workspace ? <span>· {workspace.name}</span> : null}
        </>
      }
    />
  );
}
