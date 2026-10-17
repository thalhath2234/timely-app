import { CreateCustomFieldInline, GroupLabel, ListGroup } from "@timely/ui";
import { useEffect, useRef } from "react";

/** Opens the inline form, types a name, and (optionally) switches the type via the Select panel and fills two options. */
function OpenForm({ name, type, children }: { name: string; type?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    root?.querySelector<HTMLButtonElement>("button")?.click();
    const timer = setTimeout(() => {
      const input = root?.querySelector<HTMLInputElement>('input[placeholder="Field name"]');
      if (input) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, name);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.blur();
      }
      if (!type) return;
      root?.querySelector<HTMLButtonElement>("button[aria-haspopup]")?.click();
      setTimeout(() => {
        const option = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find((o) => o.textContent?.trim() === type);
        option?.click();
        setTimeout(() => {
          Array.from(root?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((b) => b.textContent?.trim() === "+ Add option")?.click();
          setTimeout(() => {
            const inputs = Array.from(root?.querySelectorAll<HTMLInputElement>('input[placeholder^="Option"]') ?? []);
            ["First pass", "Client review"].forEach((value, i) => {
              const el = inputs[i];
              if (!el) return;
              Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, value);
              el.dispatchEvent(new Event("input", { bubbles: true }));
            });
          }, 50);
        }, 50);
      }, 100);
    }, 50);
    return () => clearTimeout(timer);
  }, [name, type]);
  return <div ref={ref}>{children}</div>;
}

const Sidebar = ({ children }: { children: React.ReactNode }) => (
  <div className="p-4">
    <div style={{ width: 320 }}>
      <GroupLabel>Custom fields</GroupLabel>
      <ListGroup>{children}</ListGroup>
    </div>
  </div>
);

export const Collapsed = () => (
  <Sidebar>
    <CreateCustomFieldInline variant="row" workspaceId="ws_studio" />
  </Sidebar>
);

export const TextField = () => (
  <Sidebar>
    <OpenForm name="Client">
      <CreateCustomFieldInline variant="row" workspaceId="ws_studio" />
    </OpenForm>
  </Sidebar>
);

export const SelectWithOptions = () => (
  <Sidebar>
    <OpenForm name="Review round" type="Select">
      <CreateCustomFieldInline variant="row" workspaceId="ws_studio" />
    </OpenForm>
  </Sidebar>
);

export const NoWorkspaceSelected = () => (
  <Sidebar>
    <CreateCustomFieldInline />
  </Sidebar>
);
