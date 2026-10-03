import { OverlayScrim } from "@timely/ui";

const Backdrop = () => (
  <div className="flex flex-col gap-2 p-6">
    <h2 className="text-lg font-semibold text-foreground">Today</h2>
    {["Draft onboarding flow", "Review Q4 roadmap with Sam", "Prepare sprint demo"].map((name) => (
      <div key={name} className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground">{name}</div>
    ))}
  </div>
);

export const OverPage = () => (
  <div className="relative overflow-hidden rounded-xl border border-border bg-background" style={{ width: 520, height: 260 }}>
    <Backdrop />
    <OverlayScrim />
  </div>
);

export const ModalBlur = () => (
  <div className="relative overflow-hidden rounded-xl border border-border bg-background" style={{ width: 520, height: 260 }}>
    <Backdrop />
    <OverlayScrim className="bg-black/70 backdrop-blur-[6px]" />
  </div>
);
