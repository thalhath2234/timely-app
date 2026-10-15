"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ChevronRight,
  Copy,
  Download,
  LayoutTemplate,
  Share2,
  Smile,
  Star,
  Trash2,
} from "lucide-react";
import SheetGrid, { type SheetGridChange } from "@/app/_components/sheets/sheetGrid";
import { Sheet, SheetTab } from "@/app/_types/types";
import { UpdateSheetPayload } from "@/app/utils/api/sheets";
import {
  useCreateSheetTemplate,
  useDeleteSheet,
  useDuplicateSheet,
  useMaterializeTemplateTab,
  useSheet,
  useSheetTemplates,
  useUpdateSheet,
} from "@/app/utils/hooks/sheets";
import { useAutosave } from "@/app/utils/hooks/useAutosave";
import SaveStatusBadge from "@/app/_components/_ui/saveStatus";
import { showUndoToast, useToastStore } from "@/app/_store/toastStore";
import { createSheetEvaluator } from "@timely/contract/sheetFormula";
import { downloadCsv, sheetToCsv } from "@/app/utils/sheetCsv";
import {
  addWorkbookTab,
  duplicateWorkbookTab,
  tabsFromSheet,
} from "@/app/utils/sheetWorkbook";
import { adjustTabForStructure, renameSheetInTabs, type StructureChange } from "@timely/contract/sheetOps";
import { useContextMenu } from "@/app/_components/_ui/contextMenu";
import { addTabMenuItems } from "@/app/_components/sheets/sheetTemplateMenu";
import { registerSheetFlush } from "@/app/utils/sheetFlush";
import { SHEET_ICON_CHOICES } from "@/app/_components/sheets/sheetIcons";
import { fileHref, FILES_PATH } from "@/app/utils/fileRoutes";
import { buttonClass } from "@/app/_components/_ui/button";

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

export default function SheetPage({ id }: { id: string }) {
  const { data: sheet, isLoading, isError, error } = useSheet(id);

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
          href={FILES_PATH}
          className={buttonClass({ variant: "secondary", size: "lg" })}
        >
          Back to files
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
  const createTemplate = useCreateSheetTemplate();
  const templatesQuery = useSheetTemplates();
  const materializeTab = useMaterializeTemplateTab();
  const openMenu = useContextMenu();

  const [title, setTitle] = useState(sheet.title);
  const [tabs, setTabs] = useState<SheetTab[]>(() => tabsFromSheet(sheet));
  const [activeTabId, setActiveTabId] = useState(tabs[0]?.id ?? "");
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const tabsRef = useRef(tabs);
  /**
   * Tabs changed since the last confirmed save. Only these are sent, with the
   * tab order, so two devices editing different tabs don't overwrite each
   * other. A sheet saved before tabs existed sends every tab once.
   */
  const dirtyTabsRef = useRef<Set<string>>(
    new Set(sheet.tabs && sheet.tabs.length > 0 ? [] : tabs.map((tab) => tab.id)),
  );

  const { schedule, flush, status } = useAutosave<UpdateSheetPayload>(async (patch) => {
    const result = await updateSheet.mutateAsync({ id: sheet.id, ...patch });
    // A tab is clean once the copy that was sent is still the current one.
    for (const sent of patch.tabs ?? []) {
      if (tabsRef.current.find((tab) => tab.id === sent.id) === sent) dirtyTabsRef.current.delete(sent.id);
    }
    return result;
  });

  useEffect(() => registerSheetFlush(sheet.id, flush), [sheet.id, flush]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  const persistTabs = (nextTabs: SheetTab[]) => {
    const previous = tabsRef.current;
    for (const tab of nextTabs) {
      if (previous.find((item) => item.id === tab.id) !== tab) dirtyTabsRef.current.add(tab.id);
    }
    const ids = new Set(nextTabs.map((tab) => tab.id));
    for (const id of [...dirtyTabsRef.current]) if (!ids.has(id)) dirtyTabsRef.current.delete(id);
    tabsRef.current = nextTabs;
    setTabs(nextTabs);
    if (!nextTabs.some((tab) => tab.id === activeTabId) && nextTabs[0]) {
      setActiveTabId(nextTabs[0].id);
    }
    schedule({
      tabs: nextTabs.filter((tab) => dirtyTabsRef.current.has(tab.id)),
      tabOrder: nextTabs.map((tab) => tab.id),
    });
  };

  const handleDelete = async () => {
    await deleteSheet.mutateAsync(sheet.id);
    router.push(FILES_PATH);
  };

  const handleGridChange = (next: SheetGridChange, meta?: { structure?: StructureChange }) => {
    const current = tabsRef.current;
    const active = current.find((tab) => tab.id === activeTabId) ?? current[0];
    if (!active) return;
    persistTabs(
      current.map((tab) => {
        if (tab.id === active.id) {
          const updated: SheetTab = { ...tab };
          for (const key of Object.keys(next) as (keyof SheetGridChange)[]) {
            if (next[key] !== undefined) (updated as unknown as Record<string, unknown>)[key] = next[key];
          }
          return updated;
        }
        // Rows or columns moved in the active tab: references to it follow.
        return meta?.structure ? adjustTabForStructure(tab, meta.structure, active.name) : tab;
      }),
    );
  };

  const renameTab = (id: string, name: string) => {
    const current = tabsRef.current;
    const tab = current.find((item) => item.id === id);
    if (!tab) return;
    const wanted = name.trim() || tab.name;
    // Tab names stay unique so formulas can tell them apart.
    let unique = wanted;
    for (let n = 2; current.some((item) => item.id !== id && item.name.toLowerCase() === unique.toLowerCase()); n += 1) {
      unique = `${wanted} ${n}`;
    }
    if (unique === tab.name) return;
    const renamed = current.map((item) => (item.id === id ? { ...item, name: unique } : item));
    persistTabs(renameSheetInTabs(renamed, tab.name, unique));
  };

  const deleteTab = (id: string) => {
    const current = tabsRef.current;
    if (current.length <= 1) return;
    const index = current.findIndex((tab) => tab.id === id);
    const removed = current[index];
    if (!removed) return;
    persistTabs(current.filter((tab) => tab.id !== id));
    showUndoToast(`Deleted “${removed.name}”`, () => {
      const now = tabsRef.current;
      if (now.some((tab) => tab.id === removed.id)) return;
      const restored = [...now];
      restored.splice(Math.min(index, restored.length), 0, removed);
      setActiveTabId(removed.id);
      persistTabs(restored);
    });
  };

  const moveTab = (id: string, direction: -1 | 1) => {
    const current = [...tabsRef.current];
    const index = current.findIndex((tab) => tab.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return;
    [current[index], current[target]] = [current[target], current[index]];
    persistTabs(current);
  };

  const handleExport = () => {
    if (!activeTab) return;
    const evaluator = createSheetEvaluator(activeTab.columns, activeTab.rows, { tabs, currentTabId: activeTab.id });
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
    () => tabs.map((tab) => ({ id: tab.id, name: tab.name, color: tab.color })),
    [tabs],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground" style={KINETIC_THEME}>
      <header className="flex min-h-14 items-center gap-2 border-b border-border bg-background px-4 py-2">
        <nav className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <Link
            href={FILES_PATH}
            className="shrink-0 transition-colors hover:text-foreground"
          >
            Files
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
                  {SHEET_ICON_CHOICES.map((icon) => (
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
                  className={buttonClass({ variant: "secondary", size: "sm", className: "mt-2 w-full" })}
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
          title="Save as template"
          disabled={createTemplate.isPending}
          onClick={() => {
            void (async () => {
              if (!(await flush())) {
                useToastStore.getState().show("Could not save changes");
                return;
              }
              try {
                const template = await createTemplate.mutateAsync({
                  sheetId: sheet.id,
                  name: title || sheet.title,
                });
                useToastStore.getState().show(`Saved template “${template.name}”`);
              } catch (error: unknown) {
                useToastStore
                  .getState()
                  .show(error instanceof Error ? error.message : "Could not save template");
              }
            })();
          }}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent"
        >
          <LayoutTemplate className="size-4" />
        </button>

        <button
          type="button"
          title="Duplicate"
          disabled={duplicateSheet.isPending}
          onClick={() => {
            void duplicateSheet.mutateAsync(sheet.id).then((copy) => {
              showUndoToast(`Duplicated “${copy.title}”`);
              router.push(fileHref(copy.id));
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
                  className={buttonClass({ variant: "secondary", size: "sm" })}
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
          className={buttonClass({ size: "sm", className: "ml-1" })}
        >
          <Share2 className="size-3.5" />
          Share
        </button>
      </header>

      <div className="min-h-0 flex-1">
        {activeTab && (
          <SheetGrid
            columns={activeTab.columns}
            rows={activeTab.rows}
            merges={activeTab.merges ?? []}
            frozenRows={activeTab.frozenRows ?? 0}
            frozenCols={activeTab.frozenCols ?? 0}
            conditionalFormats={activeTab.conditionalFormats}
            workbook={tabs}
            onChange={handleGridChange}
            tabs={tabItems}
            activeTabId={activeTab.id}
            onSelectTab={setActiveTabId}
            onAddTab={(event) => {
              const templates = templatesQuery.data ?? [];
              const addBlank = () => {
                const next = addWorkbookTab(tabs);
                setActiveTabId(next[next.length - 1]!.id);
                persistTabs(next);
              };
              if (templates.length === 0) {
                addBlank();
                return;
              }
              openMenu(
                event,
                addTabMenuItems({
                  templates,
                  onBlank: addBlank,
                  onTemplate: (templateId, tabId) => {
                    void materializeTab
                      .mutateAsync({ templateId, tabId })
                      .then((tab) => {
                        const next = addWorkbookTab(tabsRef.current, tab);
                        setActiveTabId(next[next.length - 1]!.id);
                        persistTabs(next);
                      })
                      .catch((error: unknown) =>
                        useToastStore
                          .getState()
                          .show(
                            error instanceof Error ? error.message : "Could not add tab",
                          ),
                      );
                  },
                }),
                { title: "New tab" },
              );
            }}
            onRenameTab={renameTab}
            onDeleteTab={deleteTab}
            onMoveTab={moveTab}
            onDuplicateTab={(id) => {
              const next = duplicateWorkbookTab(tabsRef.current, id);
              if (next === tabsRef.current) return;
              const copy = next[next.findIndex((tab) => tab.id === id) + 1];
              if (copy) setActiveTabId(copy.id);
              persistTabs(next);
            }}
            onColorTab={(id, color) =>
              persistTabs(
                tabsRef.current.map((tab) => {
                  if (tab.id !== id) return tab;
                  const next = { ...tab };
                  if (color) next.color = color;
                  else delete next.color;
                  return next;
                }),
              )
            }
          />
        )}
      </div>
    </div>
  );
}
