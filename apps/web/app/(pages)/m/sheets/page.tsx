"use client";

import { useMemo, useState } from "react";
import { Search, Sheet as SheetIcon, X } from "lucide-react";
import MobileHeader, { HeaderIconButton } from "@/app/_components/mobile/MobileHeader";
import SheetCard from "@/app/_components/mobile/sheets/SheetCard";
import EmptyState from "@/app/_components/mobile/EmptyState";
import { SectionLabel } from "@/app/_components/mobile/ListCard";
import { useMobileSheets, useMobileWorkspaces } from "@/app/_lib/mobile/useMobileData";

export default function MobileSheetsPage() {
  const { data: sheets, isDemo } = useMobileSheets();
  const { data: workspaces } = useMobileWorkspaces();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  const wsById = useMemo(() => new Map(workspaces.map((w) => [w.id, w])), [workspaces]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sheets
      .filter((s) => !s.archivedAt)
      .filter((s) => (q ? s.title.toLowerCase().includes(q) : true))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [sheets, query]);

  const favorites = visible.filter((s) => s.isFavorite);
  const rest = visible.filter((s) => !s.isFavorite);

  return (
    <>
      <MobileHeader
        title="Sheets"
        subtitle={`${visible.length} sheets`}
        isDemo={isDemo}
        actions={
          <HeaderIconButton
            label={searchOpen ? "Close search" : "Search"}
            active={searchOpen}
            onClick={() => {
              setSearchOpen((v) => !v);
              setQuery("");
            }}
          >
            {searchOpen ? <X size={20} /> : <Search size={20} />}
          </HeaderIconButton>
        }
      >
        {searchOpen ? (
          <div className="px-3 pb-3">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sheets"
              aria-label="Search sheets"
              className="h-11 w-full rounded-xl border border-input bg-card px-4 text-[16px] text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
            />
          </div>
        ) : null}
      </MobileHeader>

      <main className="min-h-0 flex-1 overflow-y-auto px-3 pb-28">
        {visible.length === 0 ? (
          <EmptyState icon={SheetIcon} title="No sheets yet" description="Tap + to create one." />
        ) : (
          <>
            {favorites.length ? (
              <>
                <SectionLabel>Favorites</SectionLabel>
                <ul className="flex flex-col gap-2">
                  {favorites.map((s) => (
                    <li key={s.id}>
                      <SheetCard sheet={s} workspace={wsById.get(s.workspaceId)} />
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {rest.length ? (
              <>
                <SectionLabel>All sheets</SectionLabel>
                <ul className="flex flex-col gap-2">
                  {rest.map((s) => (
                    <li key={s.id}>
                      <SheetCard sheet={s} workspace={wsById.get(s.workspaceId)} />
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        )}
      </main>
    </>
  );
}
