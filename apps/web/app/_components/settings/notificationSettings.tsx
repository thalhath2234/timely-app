"use client";

import { FormEvent, useState } from "react";
import { jobKindLabel } from "@timely/contract/notifications";
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
import { useDecisions } from "@/app/utils/hooks/decisions";
import { buttonClass } from "@/app/_components/_ui/button";
import { settingsColumns } from "./layout";
import { useRouter } from "next/navigation";
import { Bot } from "lucide-react";
import { ListGroup, ListRow, ListSubLabel } from "@/app/_components/_ui/groupedList";
import { LoadErrorBanner } from "@/app/_components/_ui/loadError";
import { alertDefaultRows, useAlertDefaults } from "@/app/_components/bots/alertDefaults";

export default function NotificationSettingsPanel() {
  const { data: settings, isLoading, isError } = useNotificationSettings();

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading notification settings…</p>;
  }
  if (isError || !settings) {
    return <p className="text-sm text-muted-foreground">Could not load notification settings.</p>;
  }

  return (
    <div className={settingsColumns}>
      <NotificationSettingsForm key={JSON.stringify(settings)} initial={settings} />
      {/* Bots sit above the jobs list: below the form when stacked, beside it when wide. */}
      <div className="flex min-w-0 flex-col gap-10">
        <BotNotificationSettings />
        <FailedJobsPanel />
      </div>
    </div>
  );
}

function NotificationSettingsForm({ initial }: { initial: NotificationSettings }) {
  const update = useUpdateNotificationSettings();
  const smart = useDecisions().data?.available === true;
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
      {smart ? (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={draft.smartAlerts !== false}
            onChange={() => setDraft((current) => ({ ...current, smartAlerts: current.smartAlerts === false }))}
          />
          <span>
            Smart alerts
            <span className="block text-xs text-muted-foreground">
              Up to three a day, from the morning digest time, for work worth acting on: due soon with no time, ready to start, idle for weeks, or an Inbox that waits. Needs smart suggestions.
            </span>
          </span>
        </label>
      ) : null}
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
          className={buttonClass()}
        >
          {update.isPending ? "Saving..." : "Save notification settings"}
        </button>
      </div>
    </form>
  );
}

/** Where new bots alert (they save at once, unlike the form) and a way to the Bots page. */
function BotNotificationSettings() {
  const router = useRouter();
  const state = useAlertDefaults();
  const { defaults } = state;
  return (
    <section className="max-w-xl">
      <h2 className="text-base font-semibold">Bots</h2>
      <p className="mb-3 mt-1 text-sm text-muted-foreground">Each bot has its own alerts. These are what new bots start with.</p>
      {defaults.isError && !defaults.data ? (
        <LoadErrorBanner
          what="where new bots alert"
          error={defaults.error}
          hasCopy={false}
          onRetry={() => void defaults.refetch()}
          retrying={defaults.isFetching}
          className="mb-2"
        />
      ) : null}
      <ListGroup>
        <ListSubLabel>Alerts for new bots</ListSubLabel>
        {alertDefaultRows(state)}
        <ListRow
          label="Open Bots"
          icon={<Bot aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
          onClick={() => router.push("/bots")}
        />
      </ListGroup>
    </section>
  );
}

function FailedJobsPanel() {
  const jobs = useFailedJobs();
  const health = useJobHealth();
  const retry = useRetryJob();
  const [retryError, setRetryError] = useState<{ id: string; message: string } | null>(null);
  const items = jobs.data ?? [];

  async function retryJob(id: string) {
    setRetryError(null);
    try {
      await retry.mutateAsync(id);
    } catch (err) {
      setRetryError({ id, message: err instanceof Error ? err.message : "Couldn’t retry this job." });
    }
  }

  return (
    <section className="max-w-xl">
      <h2 className="text-base font-semibold">Background jobs</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Reminders, digests, alerts and search index updates that failed show up here. Retry runs one again.
        Retrying smart alerts or a search index job uses your AI provider again.
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {health.data?.pending ?? 0} waiting
        {health.data?.running ? `, ${health.data.running} running` : ""}, {health.data?.failed ?? 0} failed
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
                  {jobKindLabel(job.kind)}{" "}
                  <span className="text-muted-foreground">
                    · {job.attempts} of {job.maxAttempts} tries
                  </span>
                </span>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  disabled={retry.isPending}
                  onClick={() => void retryJob(job.id)}
                >
                  Retry
                </button>
              </div>
              {job.lastError ? (
                <p title={job.lastError} className="mt-1 line-clamp-3 break-words text-xs text-destructive">
                  {job.lastError}
                </p>
              ) : null}
              {retryError?.id === job.id ? (
                <p role="status" className="mt-2 break-words text-xs text-foreground">
                  {retryError.message}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
