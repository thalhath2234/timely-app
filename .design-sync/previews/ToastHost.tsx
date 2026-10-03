import { ToastHost, useToastStore } from "@timely/ui";
import { useEffect } from "react";

const HOUR = 60 * 60 * 1000;

// ToastHost is position:fixed (bottom-right). The transform makes this box its
// containing block, so the stack sits in a sized frame instead of the viewport.
const Frame = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-xl border border-border bg-background" style={{ width: 400, height: 240, transform: "translateZ(0)" }}>
    {children}
  </div>
);

function useToasts(list: { message: string; action?: string }[]) {
  useEffect(() => {
    useToastStore.setState({ toasts: [] });
    const { show } = useToastStore.getState();
    list.forEach((toast) =>
      show(toast.message, toast.action ? { label: toast.action, onAction: () => undefined } : undefined, HOUR),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export const UndoToast = () => {
  useToasts([{ message: "Task completed", action: "Undo" }]);
  return (
    <Frame>
      <ToastHost />
    </Frame>
  );
};

export const Stacked = () => {
  useToasts([
    { message: "Moved “Draft onboarding flow” to Website relaunch", action: "Undo" },
    { message: "3 tasks scheduled for tomorrow" },
    { message: "Deleted “Book venue for team offsite”", action: "Undo" },
  ]);
  return (
    <Frame>
      <ToastHost />
    </Frame>
  );
};
