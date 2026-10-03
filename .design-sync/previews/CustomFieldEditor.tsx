import { CustomFieldEditor } from "@timely/ui";
import { useEffect, useRef, useState } from "react";

const t = "2024-05-01T09:00:00Z";
const field = (id: string, name: string, type: string, options: { id: string; value: string; color: string }[] = []) => ({
  id,
  name,
  type,
  workspaceId: "ws_studio",
  createdTime: t,
  updatedTime: t,
  options: { options },
});

const FIELDS = [
  field("cf_effort", "Effort", "select", [
    { id: "opt_s", value: "Small", color: "#30A66D" },
    { id: "opt_m", value: "Medium", color: "#FFB224" },
    { id: "opt_l", value: "Large", color: "#E5484D" },
  ]),
  field("cf_figma", "Figma file", "url"),
  field("cf_estimate", "Estimate (hours)", "number"),
  field("cf_client", "Client approved", "boolean"),
  field("cf_channels", "Channels", "multi_select", [
    { id: "opt_web", value: "Web", color: "#0091FF" },
    { id: "opt_ios", value: "iOS", color: "#6E56CF" },
  ]),
];

type Field = (typeof FIELDS)[number];
type Payload = { name: string; type: string; options?: { value: string; color: string }[] };

function useFields(initial: Field[]) {
  const [fields, setFields] = useState(initial);
  const toField = (id: string, p: Payload) =>
    field(id, p.name, p.type, (p.options ?? []).map((o, i) => ({ id: `${id}_${i}`, ...o })));
  return {
    fields,
    onCreate: async (p: Payload) => setFields((list) => [...list, toField(`cf_new_${list.length}`, p)]),
    onUpdate: async (id: string, p: Payload) => setFields((list) => list.map((f) => (f.id === id ? toField(id, p) : f))),
    onDelete: async (id: string) => setFields((list) => list.filter((f) => f.id !== id)),
  };
}

/** Clicks the first button matching the selector once on mount. */
function ClickOnMount({ selector, children }: { selector: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>(selector)?.click();
  }, [selector]);
  return <div ref={ref}>{children}</div>;
}

const Frame = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-background p-6" style={{ width: 640 }}>{children}</div>
);

export const WorkspaceFields = () => {
  const props = useFields(FIELDS);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <Frame><CustomFieldEditor {...(props as any)} /></Frame>;
};

export const EditingSelectField = () => {
  const props = useFields(FIELDS.slice(0, 3));
  return (
    <Frame>
      <ClickOnMount selector='button[aria-label="Edit Effort"]'>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <CustomFieldEditor {...(props as any)} />
      </ClickOnMount>
    </Frame>
  );
};

export const NoFields = () => {
  const props = useFields([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <Frame><CustomFieldEditor {...(props as any)} /></Frame>;
};
