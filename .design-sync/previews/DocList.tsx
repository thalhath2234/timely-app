import { DocList, TimelyProvider } from "@timely/ui";
import { useEffect, useRef } from "react";

const Frame = ({ children, frameRef }: { children: React.ReactNode; frameRef?: React.Ref<HTMLDivElement> }) => (
  <div ref={frameRef} className="flex bg-background" style={{ width: 300, height: 520 }}>
    {children}
  </div>
);

/** Runs `act` against the list once the sample docs have loaded. */
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

export const PageTree = () => {
  const ref = useOnceLoaded((root) => {
    const expand = root.querySelector<HTMLButtonElement>('button[aria-label="Expand"]:not(.invisible)');
    expand?.click();
    return !!expand;
  });
  return (
    <Frame frameRef={ref}>
      <DocList />
    </Frame>
  );
};

export const SearchResults = () => {
  const ref = useOnceLoaded((root) => {
    const input = root.querySelector<HTMLInputElement>('input[placeholder="Search docs"]');
    if (!input || !root.querySelector('a[href^="/docs/"]')) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "interview");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  });
  return (
    <Frame frameRef={ref}>
      <DocList />
    </Frame>
  );
};

export const ConfirmDelete = () => {
  const ref = useOnceLoaded((root) => {
    const expand = root.querySelector<HTMLButtonElement>('button[aria-label="Expand"]:not(.invisible)');
    const remove = root.querySelector<HTMLButtonElement>('button[title="Delete"]');
    expand?.click();
    remove?.click();
    return !!remove;
  });
  return (
    <Frame frameRef={ref}>
      <DocList />
    </Frame>
  );
};

export const NoDocsYet = () => (
  <TimelyProvider animations={false} seed={[[["docs"], []]]}>
    <Frame>
      <DocList />
    </Frame>
  </TimelyProvider>
);
