import { BulkActionBar, sampleApi } from "@timely/ui";
import { useEffect, useRef, useState } from "react";

// Reads the same sample workspace TimelyProvider serves, so rows passed as
// props match what the mocked API returns to the component's own queries.
let api: any = null;
function get<T = any>(route: string, params: Record<string, string> = {}, query = ""): T {
  api ??= sampleApi();
  return api[route]({ method: "GET", path: "", params, query: new URLSearchParams(query), body: undefined });
}

function Bar({ ids }: { ids: string[] }) {
  const [selected, setSelected] = useState(ids);
  return (
    <BulkActionBar
      ids={selected}
      workspaces={get("GET /workspaces")}
      projects={get("GET /projects")}
      onClear={() => setSelected([])}
    />
  );
}

export const ThreeSelected = () => (
  <div className="bg-background" style={{ width: 1100 }}>
    <Bar ids={["tsk_welcome_wireframes", "tsk_empty_state_copy", "tsk_invite_screen"]} />
  </div>
);

export const OneSelected = () => (
  <div className="bg-background" style={{ width: 1100 }}>
    <Bar ids={["tsk_spacing_tokens"]} />
  </div>
);

export const StatusMenuOpen = () => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const button = Array.from(ref.current?.querySelectorAll("button") ?? []).find((b) =>
      b.textContent?.includes("Status"),
    );
    button?.click();
  }, []);
  return (
    <div ref={ref} className="bg-background" style={{ width: 1100, height: 320 }}>
      <Bar ids={["tsk_welcome_wireframes", "tsk_empty_state_copy", "tsk_invite_screen", "tsk_contrast_pass"]} />
    </div>
  );
};
