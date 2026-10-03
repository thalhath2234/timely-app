import { ExpandCollapsedListButton } from "@timely/ui";

function collapse(key: string) {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // storage blocked
  }
}

export const DocsHeader = () => {
  collapse("timely.docsListCollapsed");
  return (
    <div className="w-[520px] px-6 py-5">
      <div className="flex items-center gap-2">
        <ExpandCollapsedListButton storageKey="timely.docsListCollapsed" label="docs list" />
        <h1 className="text-2xl font-semibold text-foreground">Docs</h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Write notes, specs and meeting minutes.
      </p>
    </div>
  );
};

export const SheetToolbar = () => {
  collapse("timely.sheetsListCollapsed");
  return (
    <div className="w-[520px] p-4">
      <div className="flex h-11 items-center gap-2 border-b border-border px-3">
        <ExpandCollapsedListButton storageKey="timely.sheetsListCollapsed" label="sheets list" />
        <span className="truncate text-sm font-medium text-foreground">Q2 content calendar</span>
      </div>
    </div>
  );
};
