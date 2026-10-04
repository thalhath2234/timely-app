import { PageFade } from "@timely/ui";

export const TodayPage = () => (
  <div className="rounded-xl border border-border bg-background" style={{ width: 640, height: 320 }}>
    <PageFade>
      <div className="flex flex-col gap-3 px-6 py-5">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Today</h1>
          <p className="mt-1 text-sm text-muted-foreground">Wednesday, May 15 · 4 tasks, 2 events</p>
        </div>
        {[
          ["9:00", "Draft onboarding flow", "Website relaunch"],
          ["11:30", "Review Q4 roadmap with Sam", "Q4 research sprint"],
          ["14:00", "Prepare sprint demo", "Website relaunch"],
        ].map(([time, name, project]) => (
          <div key={name} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm">
            <span style={{ width: 48 }} className="shrink-0 font-mono text-xs text-muted-foreground">{time}</span>
            <span className="flex-1 text-foreground">{name}</span>
            <span className="text-xs text-muted-foreground">{project}</span>
          </div>
        ))}
      </div>
    </PageFade>
  </div>
);
