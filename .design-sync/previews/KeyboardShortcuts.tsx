import { KeyboardShortcuts } from "@timely/ui";

// KeyboardShortcuts renders nothing: it binds global keys. The card shows the
// bindings it installs, styled like the app's own kbd hints.
const GO = [
  ["G then Y", "Today"],
  ["G then I", "Inbox"],
  ["G then C", "Calendar"],
  ["G then T", "Tasks"],
  ["G then P", "Projects"],
  ["G then D", "Docs"],
  ["G then A", "Chat"],
];
const ACTIONS = [
  ["C / N", "New task (C focuses capture on Inbox)"],
  ["/", "Search"],
  ["X", "Complete the open task, with Undo"],
  ["S", "Find time for the open task"],
];

const Row = ({ keys, label }: { keys: string; label: string }) => (
  <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
    <span className="text-foreground">{label}</span>
    <span className="inline-flex items-center gap-1">
      {keys.split(" ").map((k, i) =>
        k === "then" || k === "/" && keys !== "/" ? (
          <span key={i} className="text-[11px] text-muted-foreground">{k}</span>
        ) : (
          <kbd key={i} className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground">{k}</kbd>
        ),
      )}
    </span>
  </div>
);

export const GlobalBindings = () => (
  <div className="flex gap-4 p-4" style={{ width: 760 }}>
    <KeyboardShortcuts />
    <section className="flex-1">
      <p className="mb-1.5 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Go to</p>
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
        {GO.map(([k, l]) => <Row key={k} keys={k} label={l} />)}
      </div>
    </section>
    <section className="flex-1">
      <p className="mb-1.5 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</p>
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
        {ACTIONS.map(([k, l]) => <Row key={k} keys={k} label={l} />)}
      </div>
    </section>
  </div>
);
