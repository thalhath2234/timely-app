"use client";

import { FormEvent, useState } from "react";
import { TimeField } from "@/app/_components/_ui/datePicker";
import {
  useFailedJobs,
  useJobHealth,
  useNotificationSettings,
  useRetryJob,
  useUpdateNotificationSettings,
} from "@/app/utils/hooks/notifications";
import TimezoneSelect from "@/app/_components/_ui/timezoneSelect";
import type { NotificationSettings } from "@/app/_types/types";
import { browserTimezone } from "@/app/utils/api/schedule";

export default function NotificationSettingsPanel() {
  const { data: settings, isLoading, isError } = useNotificationSettings();

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading notification settings…</p>;
  }
  if (isError || !settings) {
    return <p className="text-sm text-muted-foreground">Could not load notification settings.</p>;
  }

  return (
    <div className="flex flex-col gap-12">
      <NotificationSettingsForm key={JSON.stringify(settings)} initial={settings} />
      <FailedJobsPanel />
    </div>
  );
}

function NotificationSettingsForm({ initial }: { initial: NotificationSettings }) {
  const update = useUpdateNotificationSettings();
  const [draft, setDraft] = useState<NotificationSettings>({
    ...initial,
    timezone: initial.timezone || browserTimezone(),
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (key: "reminders" | "digestMorning" | "digestEvening" | "planning") => {
    setDraft((current) => {
      const next = { ...current, [key]: !current[key] };
      if (key === "digestMorning") next.planning = next.digestMorning;
      return next;
    });
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    try {
      await update.mutateAsync({ ...draft, planning: draft.digestMorning });
      setMessage("Notification preferences saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold">Alerts</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Server-side reminders and digests still appear in the notification center during quiet hours; push waits until quiet hours end.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.reminders} onChange={() => toggle("reminders")} />
        Reminder pings
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.digestMorning} onChange={() => toggle("digestMorning")} />
        Morning planning digest
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.digestEvening} onChange={() => toggle("digestEvening")} />
        End-of-day recap
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Morning at
          <TimeField value={draft.morningDigestAt} onChange={(morningDigestAt) => setDraft({ ...draft, morningDigestAt })} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Evening at
          <TimeField value={draft.eveningDigestAt} onChange={(eveningDigestAt) => setDraft({ ...draft, eveningDigestAt })} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Quiet hours start
          <TimeField
            value={draft.quietHoursStart}
            onChange={(quietHoursStart) => setDraft({ ...draft, quietHoursStart })}
            clearable
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Quiet hours end
          <TimeField
            value={draft.quietHoursEnd}
            onChange={(quietHoursEnd) => setDraft({ ...draft, quietHoursEnd })}
            clearable
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Timezone
        <TimezoneSelect
          value={draft.timezone}
          onChange={(timezone) => setDraft({ ...draft, timezone })}
        />
        <span className="text-xs text-muted-foreground">
          Digest times and quiet hours are read in this zone. It follows your working-hours
          timezone unless you set a different one here.
        </span>
      </label>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {message && !error ? <p className="text-xs text-success">{message}</p> : null}
      <div>
        <button
          type="submit"
          disabled={update.isPending}
          className="cursor-pointer rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {update.isPending ? "Saving..." : "Save notification settings"}
        </button>
      </div>
    </form>
  );
}

function FailedJobsPanel() {
  const jobs = useFailedJobs();
  const health = useJobHealth();
  const retry = useRetryJob();
  const items = jobs.data ?? [];

  return (
    <section className="max-w-xl">
      <h2 className="text-base font-semibold">Background jobs</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Failed reminder, digest, and index jobs can be retried. Pending {health.data?.pending ?? 0}, failed{" "}
        {health.data?.failed ?? 0}.
      </p>
      {jobs.isLoading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading jobs…</p>
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No failed jobs.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((job) => (
            <li key={job.id} className="rounded-lg border border-border px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span>
                  {job.kind} · {job.attempts}/{job.maxAttempts}
                </span>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  disabled={retry.isPending}
                  onClick={() => void retry.mutateAsync(job.id)}
                >
                  Retry
                </button>
              </div>
              {job.lastError ? (
                <p className="mt-1 text-xs text-destructive">{job.lastError}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
