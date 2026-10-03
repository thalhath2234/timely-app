import { CustomFieldControl, PropertyRow, SidebarSectionTitle } from "@timely/ui";
import { Calendar, CheckSquare, ChevronDownCircle, Hash, Link2, Tags, Type } from "lucide-react";
import { useState } from "react";

const t = "2024-05-01T09:00:00Z";
const field = (id: string, name: string, type: any, options: { id: string; value: string; color?: string }[] = []) => ({
  id, name, type, workspaceId: "w1", createdTime: t, updatedTime: t, options: { options },
});

const FIELDS = [
  { icon: ChevronDownCircle, f: field("cf1", "Effort", "select", [
    { id: "o1", value: "Small", color: "#30A66D" },
    { id: "o2", value: "Medium", color: "#FFB224" },
    { id: "o3", value: "Large", color: "#E5484D" },
  ]) },
  { icon: Tags, f: field("cf2", "Channels", "multi_select", [
    { id: "o4", value: "Email", color: "#0090FF" },
    { id: "o5", value: "Blog", color: "#6E56CF" },
    { id: "o6", value: "Social", color: "#E93D82" },
  ]) },
  { icon: Hash, f: field("cf3", "Story points", "number") },
  { icon: Link2, f: field("cf4", "Spec link", "url") },
  { icon: Calendar, f: field("cf5", "Launch date", "date") },
  { icon: CheckSquare, f: field("cf6", "Needs review", "boolean") },
  { icon: Type, f: field("cf7", "Client", "text") },
];

type Draft = { id: string; type: any; stringValue?: string; optionsValue?: { id: string }[] };

function Panel({ initial }: { initial: Record<string, Draft> }) {
  const [values, setValues] = useState(initial);
  return (
    <div className="flex flex-col gap-1 border border-border bg-muted/10 px-5 py-5" style={{ width: 360 }}>
      <SidebarSectionTitle>Custom fields</SidebarSectionTitle>
      {FIELDS.map(({ icon, f }) => (
        <PropertyRow key={f.id} icon={icon} label={f.name}>
          <CustomFieldControl
            field={f as any}
            value={values[f.id]}
            onChange={(next) => setValues({ ...values, [f.id]: { id: f.id, type: f.type, ...next } })}
          />
        </PropertyRow>
      ))}
    </div>
  );
}

export const Filled = () => (
  <div className="p-4">
    <Panel
      initial={{
        cf1: { id: "cf1", type: "select", optionsValue: [{ id: "o2" }] },
        cf2: { id: "cf2", type: "multi_select", optionsValue: [{ id: "o4" }, { id: "o6" }] },
        cf3: { id: "cf3", type: "number", stringValue: "5" },
        cf4: { id: "cf4", type: "url", stringValue: "https://docs.studio.dev/onboarding" },
        cf5: { id: "cf5", type: "date", stringValue: "2024-06-03" },
        cf6: { id: "cf6", type: "boolean", stringValue: "true" },
        cf7: { id: "cf7", type: "text", stringValue: "Northwind" },
      }}
    />
  </div>
);

export const Empty = () => (
  <div className="p-4">
    <Panel initial={{}} />
  </div>
);
