import { ModalMain } from "@timely/ui";

const titleClass =
  "w-full bg-transparent text-3xl font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/50";

const Frame = ({ children }: { children: React.ReactNode }) => (
  <div className="flex overflow-hidden rounded-2xl border border-border bg-background" style={{ width: 640, height: 380 }}>
    {children}
  </div>
);

export const TaskTitleAndDescription = () => (
  <Frame>
    <ModalMain>
      <input defaultValue="Draft onboarding flow" className={titleClass} />
      <div className="mt-4 flex shrink-0 flex-col gap-2 rounded-lg border border-border px-3 py-3 text-sm text-foreground" style={{ height: 220 }}>
        <p>Map the first-run experience from sign-up to first scheduled task.</p>
        <p>Include empty states for Inbox and Today.</p>
      </div>
    </ModalMain>
  </Frame>
);

export const EmptyTitle = () => (
  <Frame>
    <ModalMain>
      <input placeholder="Project name" className={titleClass} />
      <p className="mt-2 text-xs text-destructive">Name is required</p>
    </ModalMain>
  </Frame>
);
