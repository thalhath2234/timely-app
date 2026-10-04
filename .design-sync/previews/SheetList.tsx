import { SheetList, TimelyProvider } from "@timely/ui";
import { useEffect, useRef } from "react";

const Frame = ({ children, frameRef }: { children: React.ReactNode; frameRef?: React.Ref<HTMLDivElement> }) => (
  <div ref={frameRef} className="flex bg-background" style={{ width: 320, height: 560 }}>
    {children}
  </div>
);

function useOnceLoaded(act: (root: HTMLElement) => boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = setInterval(() => {
      if (ref.current && act(ref.current)) clearInterval(timer);
    }, 50);
    return () => clearInterval(timer);
  }, []);
  return ref;
}

export const RecentSheets = () => (
  <Frame>
    <SheetList />
  </Frame>
);

export const ConfirmDelete = () => {
  const ref = useOnceLoaded((root) => {
    const remove = root.querySelectorAll<HTMLButtonElement>('button[title="Delete"]')[1];
    remove?.click();
    return !!remove;
  });
  return (
    <Frame frameRef={ref}>
      <SheetList />
    </Frame>
  );
};

export const NoMatches = () => {
  const ref = useOnceLoaded((root) => {
    const input = root.querySelector<HTMLInputElement>("input");
    if (!input || !root.querySelector('a[href^="/sheets/"]')) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "invoices");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  });
  return (
    <Frame frameRef={ref}>
      <SheetList />
    </Frame>
  );
};

export const NoSheetsYet = () => (
  <TimelyProvider animations={false} seed={[[["sheets"], []]]}>
    <Frame>
      <SheetList />
    </Frame>
  </TimelyProvider>
);
