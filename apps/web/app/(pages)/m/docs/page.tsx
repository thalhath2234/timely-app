"use client";

import { useMemo, useState } from "react";
import { FileText, Search, X } from "lucide-react";
import MobileHeader, { HeaderIconButton } from "@/app/_components/mobile/MobileHeader";
import DocCard from "@/app/_components/mobile/docs/DocCard";
import EmptyState from "@/app/_components/mobile/EmptyState";
import { SectionLabel } from "@/app/_components/mobile/ListCard";
import { useMobileDocs, useMobileWorkspaces } from "@/app/_lib/mobile/useMobileData";

export default function MobileDocsPage() {
  const { data: docs, isDemo } = useMobileDocs();
  const { data: workspaces } = useMobileWorkspaces();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  const wsById = useMemo(() => new Map(workspaces.map((w) => [w.id, w])), [workspaces]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs
      .filter((d) => !d.archivedAt)
      .filter((d) => (q ? d.title.toLowerCase().includes(q) || d.plainText.toLowerCase().includes(q) : true))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [docs, query]);

  const favorites = visible.filter((d) => d.isFavorite);
  const rest = visible.filter((d) => !d.isFavorite);

  return (
    <>
      <MobileHeader
        title="Docs"
        subtitle={`${visible.length} documents`}
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
              placeholder="Search docs"
              aria-label="Search docs"
              className="h-11 w-full rounded-xl border border-input bg-card px-4 text-[16px] text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
            />
          </div>
        ) : null}
      </MobileHeader>

      <main className="min-h-0 flex-1 overflow-y-auto px-3 pb-28">
        {visible.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No docs yet"
            description="Tap + to start a new document."
          />
        ) : (
          <>
            {favorites.length ? (
              <>
                <SectionLabel>Favorites</SectionLabel>
                <ul className="flex flex-col gap-2">
                  {favorites.map((d) => (
                    <li key={d.id}>
                      <DocCard doc={d} workspace={wsById.get(d.workspaceId)} />
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {rest.length ? (
              <>
                <SectionLabel>Recent</SectionLabel>
                <ul className="flex flex-col gap-2">
                  {rest.map((d) => (
                    <li key={d.id}>
                      <DocCard doc={d} workspace={wsById.get(d.workspaceId)} />
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
