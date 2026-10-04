"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChevronRight, LayoutTemplate, Plus, Smile, Trash2 } from "lucide-react";
import SheetGrid from "@/app/_components/sheets/sheetGrid";
import SaveStatusBadge from "@/app/_components/_ui/saveStatus";
import {
  useCreateSheet,
  useDeleteSheetTemplate,
  useSheetTemplates,
  useUpdateSheetTemplate,
} from "@/app/utils/hooks/sheets";
import type { UpdateSheetTemplatePayload } from "@/app/utils/api/sheets";
import { useAutosave } from "@/app/utils/hooks/useAutosave";
import type { SheetTab, SheetTemplate } from "@/app/_types/types";
import { useToastStore } from "@/app/_store/toastStore";
import { addWorkbookTab, tabsFromSheet, workbookPayload } from "@/app/utils/sheetWorkbook";
import { SHEET_ICON_CHOICES } from "@/app/_components/sheets/sheetIcons";

export default function TemplatePage() {
  const { id } = useParams<{ id: string }>();
  const templatesQuery = useSheetTemplates();
  const template = templatesQuery.data?.find((item) => item.id === id);

  if (templatesQuery.isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading template...</div>;
  }
  if (!template) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">{templatesQuery.isError ? "Could not load templates." : "Template not found."}</p>
        <Link href="/sheets" className="rounded-lg bg-secondary px-4 py-2 text-sm text-secondary-foreground">Back to sheets</Link>
      </div>
    );
  }

  return <TemplateEditor key={template.id} template={template} />;
}

function TemplateEditor({ template }: { template: SheetTemplate }) {
  const router = useRouter();
  const createSheet = useCreateSheet();
  const updateTemplate = useUpdateSheetTemplate();
  const deleteTemplate = useDeleteSheetTemplate();

  const [name, setName] = useState(template.name);
  const [tabs, setTabs] = useState<SheetTab[]>(() =>
    tabsFromSheet({ ...template, title: template.name }),
  );
  const [activeTabId, setActiveTabId] = useState(tabs[0]?.id ?? "");
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const tabsRef = useRef(tabs);

  const { schedule, flush, status } = useAutosave<UpdateSheetTemplatePayload>((patch) =>
    updateTemplate.mutateAsync({ id: template.id, ...patch }),
  );

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const tabItems = useMemo(() => tabs.map((tab) => ({ id: tab.id, name: tab.name })), [tabs]);

  const persistTabs = (nextTabs: SheetTab[]) => {
    tabsRef.current = nextTabs;
    setTabs(nextTabs);
    if (!nextTabs.some((tab) => tab.id === activeTabId) && nextTabs[0]) {
      setActiveTabId(nextTabs[0].id);
    }
    schedule(workbookPayload(nextTabs));
  };

  const handleGridChange = (next: Partial<Pick<SheetTab, "columns" | "rows" | "merges">>) => {
    if (!activeTab) return;
    persistTabs(
      tabsRef.current.map((tab) =>
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

  const createFromTemplate = async () => {
    if (!(await flush())) {
      useToastStore.getState().show("Could not save template changes");
      return;
    }
    try {
      const sheet = await createSheet.mutateAsync({ templateId: template.id });
      router.push(`/sheets/${sheet.id}`);
    } catch (error) {
      useToastStore.getState().show(error instanceof Error ? error.message : "Could not create sheet");
    }
  };

  const handleDelete = async () => {
    try {
      await deleteTemplate.mutateAsync(template.id);
      router.push("/sheets");
    } catch (error) {
      useToastStore.getState().show(error instanceof Error ? error.message : "Could not delete template");
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex min-h-14 items-center gap-2 border-b border-border px-4 py-2">
        <Link href="/sheets" className="shrink-0 text-xs text-muted-foreground hover:text-foreground">Sheets</Link>
        <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
        <LayoutTemplate className="size-4 shrink-0 text-primary" />

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setIsIconPickerOpen((previous) => !previous)}
            title="Change icon"
            className="flex size-7 items-center justify-center rounded-md bg-card text-sm"
          >
            {template.icon || <Smile className="size-4 text-muted-foreground" />}
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
                className="mt-2 w-full rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground hover:bg-accent"
              >
                Remove icon
              </button>
            </div>
          )}
        </div>

        <input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            schedule({ name: event.target.value });
          }}
          onBlur={() => void flush()}
          placeholder="Untitled template"
          aria-label="Template name"
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-muted-foreground/50"
        />
        <span className="shrink-0 rounded bg-secondary px-2 py-1 text-xs text-muted-foreground">Template</span>

        <SaveStatusBadge status={status} onRetry={() => void flush()} />

        <div className="relative shrink-0">
          <button
            type="button"
            title="Delete template"
            onClick={() => setIsConfirmingDelete((previous) => !previous)}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </button>
          {isConfirmingDelete && (
            <div className="absolute right-0 top-9 z-50 w-56 rounded-lg border border-border bg-card p-3 text-xs shadow-xl">
              <p className="text-muted-foreground">Delete this template? Sheets made from it stay.</p>
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
                  onClick={() => void handleDelete()}
                  disabled={deleteTemplate.isPending}
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
          onClick={() => void createFromTemplate()}
          disabled={createSheet.isPending}
          className="ml-1 flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          <Plus className="size-3.5" />New sheet from template
        </button>
      </header>

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
              const next = addWorkbookTab(tabsRef.current);
              setActiveTabId(next[next.length - 1]!.id);
              persistTabs(next);
            }}
            onRenameTab={(tabId, tabName) =>
              persistTabs(tabsRef.current.map((tab) => (tab.id === tabId ? { ...tab, name: tabName } : tab)))
            }
            onDeleteTab={(tabId) => {
              if (tabsRef.current.length <= 1) return;
              persistTabs(tabsRef.current.filter((tab) => tab.id !== tabId));
            }}
          />
        )}
      </div>
    </div>
  );
}
