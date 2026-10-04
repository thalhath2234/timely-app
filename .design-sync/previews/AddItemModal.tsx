import { AddItemModal, SearchModal } from "@timely/ui";
import { useEffect } from "react";

// AddItemModal opens from the sidebar store (not exported to designs). The cell
// takes the in-app path instead: Ctrl+K opens the command palette and its
// "Create …" quick action opens the modal in that mode. Both overlays are
// position:fixed (not portaled), so the transformed frame is their containing block.
const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: "calc(100vw - 48px)", height: "calc(100vh - 48px)", transform: "translateZ(0)" }}>{children}</div>
);

function typeInto(input: HTMLInputElement | null, value: string) {
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function OpenCreate({ command, title, placeholder }: { command: string; title?: string; placeholder: string }) {
  useEffect(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true, bubbles: true }));
    const timers = [
      window.setTimeout(() => {
        const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
          (el) => el.textContent?.includes(command),
        );
        option?.click();
      }, 30),
      window.setTimeout(() => {
        if (title) typeInto(document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`), title);
      }, 120),
    ];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [command, title, placeholder]);
  return (
    <Frame>
      <SearchModal />
      <AddItemModal />
    </Frame>
  );
}

export const NewTask = () => (
  <OpenCreate command="Create task" placeholder="Task name" title="Draft onboarding flow" />
);

export const NewTaskEmpty = () => <OpenCreate command="Create task" placeholder="Task name" />;

export const NewEvent = () => (
  <OpenCreate command="Create event" placeholder="Event title" title="Onboarding design critique" />
);

export const NewProject = () => (
  <OpenCreate command="Create project" placeholder="Project name" title="Website relaunch" />
);

export const NewDoc = () => (
  <OpenCreate command="Create document" placeholder="Doc title" title="Welcome flow research notes" />
);
