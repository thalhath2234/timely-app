import { SheetGrid } from "@timely/ui";
import { useEffect, useState } from "react";

// The sheet page always wraps the grid in this dark "kinetic" token scope
// (apps/web/app/(pages)/(nav_pages)/sheets/[id]/page.tsx).
const KINETIC_THEME = {
  "--background": "#111319",
  "--foreground": "#F1F3F9",
  "--card": "#1F222B",
  "--card-foreground": "#F1F3F9",
  "--popover": "#191B22",
  "--popover-foreground": "#F1F3F9",
  "--primary": "#6E56CF",
  "--primary-foreground": "#FFFFFF",
  "--secondary": "#20242E",
  "--secondary-foreground": "#F1F3F9",
  "--muted": "#191B22",
  "--muted-foreground": "#949AA8",
  "--accent": "#2A2445",
  "--accent-foreground": "#F1F3F9",
  "--border": "#282C37",
  "--input": "#282C37",
  "--ring": "#7C66DC",
} as React.CSSProperties;

type Tab = { id: string; name: string; columns: any[]; rows: any[]; merges?: any[] };

/** Loads a sample sheet and keeps edits local, like the sheet page. */
function Workbook({ sheetId, initialTab = 0 }: { sheetId: string; initialTab?: number }) {
  const [tabs, setTabs] = useState<Tab[] | null>(null);
  const [activeId, setActiveId] = useState("");
  useEffect(() => {
    void fetch(`/api-proxy/sheets/${sheetId}`)
      .then((r) => r.json())
      .then((sheet) => {
        const all: Tab[] = sheet.tabs?.length
          ? sheet.tabs
          : [{ id: "primary", name: "Sheet 1", columns: sheet.columns, rows: sheet.rows, merges: sheet.merges }];
        setTabs(all);
        setActiveId(all[initialTab]?.id ?? all[0].id);
      });
  }, [sheetId, initialTab]);
  const active = tabs?.find((t) => t.id === activeId);
  return (
    <div className="flex flex-col overflow-hidden bg-background text-foreground" style={{ ...KINETIC_THEME, width: 880, height: 560 }}>
      {active && tabs && (
        <SheetGrid
          columns={active.columns}
          rows={active.rows}
          merges={active.merges ?? []}
          onChange={(next) =>
            setTabs((all) => all!.map((t) => (t.id === active.id ? { ...t, ...next } : t)))
          }
          tabs={tabs.map((t) => ({ id: t.id, name: t.name }))}
          activeTabId={active.id}
          onSelectTab={setActiveId}
          onAddTab={() => {}}
          onRenameTab={(id, name) => setTabs((all) => all!.map((t) => (t.id === id ? { ...t, name } : t)))}
          onDeleteTab={(id) => setTabs((all) => all!.filter((t) => t.id !== id))}
        />
      )}
    </div>
  );
}

export const UsabilityTracker = () => <Workbook sheetId="sht_usability_tracker" />;

export const IssuesTab = () => <Workbook sheetId="sht_usability_tracker" initialTab={1} />;

export const ToolingBudget = () => <Workbook sheetId="sht_tooling_budget" />;
