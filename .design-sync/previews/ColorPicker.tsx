import { ColorPicker } from "@timely/ui";
import { useEffect, useRef, useState } from "react";

/** Clicks the trigger once on mount so the swatch panel is visible. */
function OpenOnMount({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button[aria-haspopup]")?.click();
  }, []);
  return <div ref={ref}>{children}</div>;
}

export const WorkspaceColor = () => {
  const [color, setColor] = useState("#6E56CF");
  return (
    <div className="flex items-center gap-2 p-4">
      <ColorPicker value={color} onChange={setColor} aria-label="Workspace color" />
      <span className="text-sm text-foreground">Personal</span>
    </div>
  );
};

export const Open = () => {
  const [color, setColor] = useState("#0090FF");
  return (
    <div className="w-[320px] p-4" style={{ height: 340 }}>
      <OpenOnMount>
        <ColorPicker value={color} onChange={setColor} aria-label="Project color" />
      </OpenOnMount>
    </div>
  );
};

export const Small = () => {
  const [color, setColor] = useState("#30A66D");
  return (
    <div className="flex items-center gap-2 p-4">
      <ColorPicker size="sm" value={color} onChange={setColor} aria-label="Label color" />
      <span className="text-xs text-muted-foreground">Deep work</span>
    </div>
  );
};

export const Disabled = () => (
  <div className="flex items-center gap-2 p-4">
    <ColorPicker value="#E5484D" onChange={() => undefined} disabled aria-label="Status color" />
    <span className="text-sm text-muted-foreground">Blocked (default status)</span>
  </div>
);
