"use client";

import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Archive,
  ChevronRight,
  Copy,
  Download,
  Share2,
  Smile,
  Star,
  Trash2,
} from "lucide-react";
import RichTextEditor from "@/app/_components/editor/richTextEditor";
import SheetGrid from "@/app/_components/sheets/sheetGrid";
import ExpandCollapsedListButton from "@/app/_components/_ui/expandCollapsedListButton";
import { Sheet, SheetTab } from "@/app/_types/types";
import { UpdateSheetPayload } from "@/app/utils/api/sheets";
import {
  useDeleteSheet,
  useDuplicateSheet,
  useSheet,
  useUpdateSheet,
} from "@/app/utils/hooks/sheets";
import { useAutosave } from "@/app/utils/hooks/useAutosave";
import { toRichContent } from "@/app/utils/richText";
import SaveStatusBadge from "@/app/_components/_ui/saveStatus";
import { showUndoToast, useToastStore } from "@/app/_store/toastStore";
import { createSheetEvaluator } from "@/app/utils/sheetFormula";
import { downloadCsv, sheetToCsv } from "@/app/utils/sheetCsv";
import {
  addWorkbookTab,
  tabsFromSheet,
  workbookPayload,
} from "@/app/utils/sheetWorkbook";

const ICON_CHOICES = [
  "📊", "📈", "📉", "🧮", "💰", "📋", "🗓️", "⚙️",
  "🎯", "🔢", "📦", "🏷️", "⏱️", "✅", "⭐", "🧾",
];

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
} as CSSProperties;

export default function SheetPage() {
  const params = useParams<{ id: string }>();
  const { data: sheet, isLoading, isError, error } = useSheet(params.id);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading sheet...
      </div>
    );
  }

  if (isError || !sheet) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">
          {error instanceof Error
            ? error.message
            : "This sheet could not be found."}
        </p>
        <Link
          href="/sheets"
          className="rounded-lg bg-secondary px-4 py-2 text-sm text-secondary-foreground transition-colors hover:bg-accent"
        >
          Back to sheets
        </Link>
      </div>
    );
  }

  return <SheetView key={sheet.id} sheet={sheet} />;
}

function SheetView({ sheet }: { sheet: Sheet }) {
  const router = useRouter();
  const updateSheet = useUpdateSheet();
  const deleteSheet = useDeleteSheet();
  const duplicateSheet = useDuplicateSheet();

  const [title, setTitle] = useState(sheet.title);
  const [tabs, setTabs] = useState<SheetTab[]>(() => tabsFromSheet(sheet));
  const [activeTabId, setActiveTabId] = useState(tabs[0]?.id ?? "");
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const { schedule, flush, status } = useAutosave<UpdateSheetPayload>((patch) =>
    updateSheet.mutateAsync({ id: sheet.id, ...patch }),
  );

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  const persistTabs = (nextTabs: SheetTab[]) => {
    setTabs(nextTabs);
    if (!nextTabs.some((tab) => tab.id === activeTabId) && nextTabs[0]) {
      setActiveTabId(nextTabs[0].id);
    }
    schedule(workbookPayload(nextTabs));
  };

  const handleDelete = async () => {
    await deleteSheet.mutateAsync(sheet.id);
    router.push("/sheets");
  };

  const handleGridChange = (next: Partial<Pick<SheetTab, "columns" | "rows" | "merges">>) => {
    if (!activeTab) return;
    persistTabs(
      tabs.map((tab) =>
        tab.id === activeTab.id
          ? {
              ...tab,
              columns: next.columns ?? tab.columns,
              rows: next.rows ?? tab.rows,
              merges: next.merges ?? tab.merges,
            }
          : tab,
      ),
    );
  };

  const handleExport = () => {
    if (!activeTab) return;
    const evaluator = createSheetEvaluator(activeTab.columns, activeTab.rows);
    const csv = sheetToCsv(activeTab.columns, activeTab.rows, evaluator.displayAt);
    downloadCsv(activeTab.name || title || "sheet", csv);
  };

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      useToastStore.getState().show("Link copied");
    } catch {
      useToastStore.getState().show("Could not copy link");
    }
  };

  const tabItems = useMemo(
    () => tabs.map((tab) => ({ id: tab.id, name: tab.name })),
    [tabs],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground" style={KINETIC_THEME}>
      <header className="flex min-h-14 items-center gap-2 border-b border-border bg-background px-4 py-2">
        <ExpandCollapsedListButton
          storageKey="timely.sheetsListCollapsed"
          label="sheets list"
        />
        <nav className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <Link
            href="/sheets"
            className="shrink-0 transition-colors hover:text-foreground"
          >
            Sheets
          </Link>
          <ChevronRight className="size-3 shrink-0" />
          <span className="max-w-24 truncate text-foreground">{activeTab?.name || "Sheet"}</span>
        </nav>

        <div className="ml-2 flex min-w-0 flex-1 items-center gap-2 border-l border-border pl-3">
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setIsIconPickerOpen((previous) => !previous)}
              title="Change icon"
              className="flex size-7 items-center justify-center rounded-md bg-card text-sm"
            >
              {sheet.icon ?? <Smile className="size-4 text-muted-foreground" />}
            </button>
            {isIconPickerOpen && (
              <div className="absolute left-0 top-9 z-50 w-64 rounded-lg border border-border bg-card p-2 shadow-xl">
                <div className="grid grid-cols-8 gap-1">
                  {ICON_CHOICES.map((icon) => (
                    <button
                      key={icon}
                      type="button"
                      onClick={() => {
                        schedule({ icon });
                        setIsIconPickerOpen(false);
                      }}
                      className="flex size-7 items-center justify-center rounded hover:bg-accent"
                    >
                      {icon}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    schedule({ icon: "" });
                    setIsIconPickerOpen(false);
                  }}
                  className="mt-2 w-full rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground hover:bg-accent"
                >
                  Remove icon
                </button>
              </div>
            )}
          </div>
          <div className="min-w-0">
            <input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                schedule({ title: event.target.value });
              }}
              onBlur={() => void flush()}
              placeholder="Untitled"
              className="block w-full min-w-0 bg-transparent text-sm font-semibold leading-5 text-foreground outline-none placeholder:text-muted-foreground/50"
            />
            <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
              <span className="rounded bg-[#2A2445] px-1.5 py-0.5 font-semibold text-[#C4B5FD]">Workbook</span>
              <span className="size-1.5 rounded-full bg-[#38BDF8]" />
              <span>Cloud sync</span>
            </div>
          </div>
        </div>

        <SaveStatusBadge status={status} onRetry={() => void flush()} />

        <button
          type="button"
          title={sheet.isFavorite ? "Remove from favorites" : "Add to favorites"}
          onClick={() => schedule({ isFavorite: !sheet.isFavorite })}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground"
        >
          <Star
            className={`size-4 ${sheet.isFavorite ? "fill-warning text-warning" : ""}`}
          />
        </button>

        <button
          type="button"
          title="Duplicate"
          disabled={duplicateSheet.isPending}
          onClick={() => {
            void duplicateSheet.mutateAsync(sheet.id).then((copy) => {
              showUndoToast(`Duplicated “${copy.title}”`);
              router.push(`/sheets/${copy.id}`);
            });
          }}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent"
        >
          <Copy className="size-4" />
        </button>

        <button
          type="button"
          title="Export CSV"
          onClick={handleExport}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent"
        >
          <Download className="size-4" />
        </button>

        <button
          type="button"
          title={sheet.archivedAt ? "Unarchive" : "Archive"}
          onClick={() => {
            const next = !sheet.archivedAt;
            schedule({ archived: next });
            showUndoToast(next ? "Archived" : "Unarchived", () =>
              schedule({ archived: !next }),
            );
          }}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent"
        >
          <Archive className={`size-4 ${sheet.archivedAt ? "text-warning" : ""}`} />
        </button>

        <div className="relative shrink-0">
          <button
            type="button"
            title="Delete sheet"
            onClick={() => setIsConfirmingDelete((previous) => !previous)}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </button>

          {isConfirmingDelete && (
            <div className="absolute right-0 top-9 z-50 w-52 rounded-lg border border-border bg-card p-3 text-xs shadow-xl">
              <p className="text-muted-foreground">Delete this sheet?</p>
              <div className="mt-2 flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsConfirmingDelete(false)}
                  className="cursor-pointer rounded-md bg-secondary px-2 py-1 text-secondary-foreground transition-colors hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleteSheet.isPending}
                  className="cursor-pointer rounded-md bg-destructive-container px-2 py-1 text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => void handleShare()}
          className="ml-1 flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Share2 className="size-3.5" />
          Share
        </button>
      </header>

      <div className="mx-4 my-2 max-h-20 overflow-auto rounded-md border border-border bg-card/60 px-3 py-1.5">
        <RichTextEditor
          variant="compact"
          toolbar="fixed"
          content={toRichContent(sheet.descriptionRich, sheet.description)}
          placeholder="Add a description. Type '@' to mention docs, tasks, or projects..."
          onChange={({ content, plainText }) =>
            schedule({ descriptionRich: content, description: plainText })
          }
        />
      </div>

      <div className="min-h-0 flex-1">
        {activeTab && (
          <SheetGrid
            columns={activeTab.columns}
            rows={activeTab.rows}
            merges={activeTab.merges ?? []}
            onChange={handleGridChange}
            tabs={tabItems}
            activeTabId={activeTab.id}
            onSelectTab={setActiveTabId}
            onAddTab={() => {
              const next = addWorkbookTab(tabs);
              setActiveTabId(next[next.length - 1]!.id);
              persistTabs(next);
            }}
            onRenameTab={(id, name) =>
              persistTabs(
                tabs.map((tab) => (tab.id === id ? { ...tab, name } : tab)),
              )
            }
            onDeleteTab={(id) => {
              if (tabs.length <= 1) return;
              persistTabs(tabs.filter((tab) => tab.id !== id));
            }}
          />
        )}
      </div>
    </div>
  );
}
