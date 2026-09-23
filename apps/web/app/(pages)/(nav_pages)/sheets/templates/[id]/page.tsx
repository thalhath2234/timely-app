"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChevronRight, LayoutTemplate, Plus } from "lucide-react";
import { useCreateSheet, useSheetTemplates } from "@/app/utils/hooks/sheets";
import type { SheetTab, SheetTemplate } from "@/app/_types/types";
import { useToastStore } from "@/app/_store/toastStore";

function templateTabs(template: SheetTemplate): SheetTab[] {
  return template.tabs?.length
    ? template.tabs
    : [{ id: template.id, name: template.name, columns: template.columns, rows: template.rows, merges: template.merges ?? [] }];
}

export default function TemplatePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const templatesQuery = useSheetTemplates();
  const createSheet = useCreateSheet();
  const [activeTabId, setActiveTabId] = useState("");
  const template = templatesQuery.data?.find((item) => item.id === id);
  const tabs = template ? templateTabs(template) : [];
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

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

  const create = async () => {
    try {
      const sheet = await createSheet.mutateAsync({ templateId: template.id });
      router.push(`/sheets/${sheet.id}`);
    } catch (error) {
      useToastStore.getState().show(error instanceof Error ? error.message : "Could not create sheet");
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex min-h-14 items-center gap-3 border-b border-border px-4">
        <Link href="/sheets" className="text-sm text-muted-foreground hover:text-foreground">Sheets</Link>
        <ChevronRight className="size-4 text-muted-foreground" />
        <LayoutTemplate className="size-4 text-primary" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{template.name}</h1>
        <span className="rounded bg-secondary px-2 py-1 text-xs text-muted-foreground">Template preview</span>
        <button type="button" onClick={() => void create()} disabled={createSheet.isPending} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60">
          <Plus className="size-4" />New sheet from template
        </button>
      </header>
      {tabs.length > 1 && (
        <nav className="flex gap-1 overflow-x-auto border-b border-border px-4 py-2" aria-label="Template tabs">
          {tabs.map((tab) => <button key={tab.id} type="button" onClick={() => setActiveTabId(tab.id)} className={`shrink-0 rounded px-3 py-1.5 text-sm ${activeTab?.id === tab.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent"}`}>{tab.name}</button>)}
        </nav>
      )}
      {activeTab && (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <table className="border-collapse text-left text-sm">
            <thead><tr><th className="sticky left-0 top-0 z-10 min-w-10 border border-border bg-card px-2 py-2" />{activeTab.columns.map((column) => <th key={column.id} className="sticky top-0 min-w-36 border border-border bg-card px-3 py-2 font-medium">{column.name}</th>)}</tr></thead>
            <tbody>{activeTab.rows.map((row, index) => <tr key={row.id}><th className="sticky left-0 border border-border bg-card px-2 py-2 text-center font-normal text-muted-foreground">{index + 1}</th>{activeTab.columns.map((column) => <td key={column.id} className="min-w-36 max-w-64 truncate border border-border px-3 py-2" title={row.cells?.[column.id] ?? ""}>{row.cells?.[column.id] ?? ""}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
