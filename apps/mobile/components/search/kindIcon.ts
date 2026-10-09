import { CalendarDays, FileText, FolderKanban, ListTodo, Table2, type LucideIcon } from "lucide-react-native";
import type { SearchKind } from "../../lib/api/search";

/** One icon per searchable kind, shared by the Search tab and related lists. */
export const SEARCH_KIND_ICONS = {
  sheet: Table2,
  doc: FileText,
  task: ListTodo,
  project: FolderKanban,
  event: CalendarDays,
} satisfies Record<string, LucideIcon>;

export function searchKindIcon(kind: SearchKind): LucideIcon {
  return SEARCH_KIND_ICONS[kind as keyof typeof SEARCH_KIND_ICONS] ?? FileText;
}
