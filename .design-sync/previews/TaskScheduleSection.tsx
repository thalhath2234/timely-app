import { TaskScheduleSection, sampleApi } from "@timely/ui";

// Reads the same sample workspace TimelyProvider serves, so rows passed as
// props match what the mocked API returns to the component's own queries.
let api: any = null;
function get<T = any>(route: string, params: Record<string, string> = {}, query = ""): T {
  api ??= sampleApi();
  return api[route]({ method: "GET", path: "", params, query: new URLSearchParams(query), body: undefined });
}

function Section({ id, patch = {} }: { id: string; patch?: Record<string, unknown> }) {
  const t = { ...get<any>("GET /tasks/:id", { id }), ...patch };
  return (
    <div className="bg-card p-4" style={{ width: 340 }}>
      <TaskScheduleSection
        taskId={t.id}
        duration={t.duration ?? 0}
        deadline={t.deadline}
        startDate={t.startDate}
        completed={Boolean(t.completedAt)}
        scheduledOn={t.scheduledOn}
        recurrence={t.recurrence}
        blocks={t.blocks}
        scheduleLocked={t.scheduleLocked}
        contiguous={t.contiguous}
        minChunkMinutes={t.minChunkMinutes}
        preferredChunkMinutes={t.preferredChunkMinutes}
        earliestStartAt={t.earliestStartAt}
        preferredWindows={t.preferredWindows}
        onRecurrenceChange={() => {}}
        onScheduledOnChange={() => {}}
      />
    </div>
  );
}

export const SplitAcrossBlocks = () => <Section id="tsk_welcome_wireframes" />;

export const PinnedBlock = () => <Section id="tsk_spacing_tokens" />;

export const NotScheduled = () => <Section id="tsk_contrast_pass" />;

export const RecurringReminder = () => <Section id="tsk_weekly_update" />;

export const Completed = () => <Section id="tsk_synthesize_interviews" />;
