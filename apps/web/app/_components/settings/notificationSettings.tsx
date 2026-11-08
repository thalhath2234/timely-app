"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { HIDDEN_PUSH_BODY, jobKindLabel } from "@timely/contract/notifications";
import { TimeField } from "@/app/_components/_ui/datePicker";
import {
  useFailedJobs,
  useJobHealth,
  useNotificationSettings,
  useRetryJob,
  useSetPushTextHidden,
  useUpdateNotificationSettings,
} from "@/app/utils/hooks/notifications";
import TimezoneSelect from "@/app/_components/_ui/timezoneSelect";
import type { NotificationSettings } from "@/app/_types/types";
import { browserTimezone } from "@/app/utils/api/schedule";
import { useDecisions } from "@/app/utils/hooks/decisions";
import { buttonClass } from "@/app/_components/_ui/button";
import { settingsColumns } from "./layout";
import { useRouter } from "next/navigation";
import { Bot, EyeOff, Power } from "lucide-react";
import { GroupHint, ListGroup, ListRow, ListSubLabel, ListSwitch } from "@/app/_components/_ui/groupedList";
import { useToastStore } from "@/app/_store/toastStore";
import { useDesktopInstance, useDesktopSetting } from "@/app/utils/hooks/desktop";
import { loginItemRow } from "@/app/utils/desktopInstance";
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
      {/* The push-text switch saves on its own, so it never resets a draft. */}
      <NotificationSettingsForm key={JSON.stringify({ ...settings, hidePushText: undefined })} initial={settings} />
      {/* This computer and Bots sit above the jobs list: below the form when stacked, beside it when wide. */}
      <div className="flex min-w-0 flex-col gap-10">
        <ThisComputerSettings />
        <BotNotificationSettings />
        <FailedJobsPanel />
      </div>
    </div>
  );
}

const rowIcon = "size-4 shrink-0 text-muted-foreground";

function NotificationSettingsForm({ initial }: { initial: NotificationSettings }) {
  const update = useUpdateNotificationSettings();
  const smart = useDecisions().data?.available === true;
  const [draft, setDraft] = useState<NotificationSettings>({
    ...initial,
    timezone: initial.timezone || browserTimezone(),
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    try {
      // hidePushText has its own endpoint; this save leaves it as stored.
      await update.mutateAsync({ ...draft, planning: draft.digestMorning, hidePushText: undefined });
      setMessage("Notification preferences saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-5">
      <h2 className="text-base font-semibold">Alerts</h2>
      <div>
        <ListGroup>
          <ListRow label="Reminders" meta="When a task or event reminder is due">
            <ListSwitch label="Reminders" checked={draft.reminders} onChange={(reminders) => setDraft({ ...draft, reminders })} />
          </ListRow>
          <ListRow label="Morning digest">
            <TimeField
              variant="row"
              aria-label="Morning digest at"
              value={draft.morningDigestAt}
              onChange={(morningDigestAt) => setDraft({ ...draft, morningDigestAt })}
            />
            <ListSwitch
              label="Morning digest"
              checked={draft.digestMorning}
              onChange={(digestMorning) => setDraft({ ...draft, digestMorning, planning: digestMorning })}
            />
          </ListRow>
          <ListRow label="Evening recap">
            <TimeField
              variant="row"
              aria-label="Evening recap at"
              value={draft.eveningDigestAt}
              onChange={(eveningDigestAt) => setDraft({ ...draft, eveningDigestAt })}
            />
            <ListSwitch
              label="Evening recap"
              checked={draft.digestEvening}
              onChange={(digestEvening) => setDraft({ ...draft, digestEvening })}
            />
          </ListRow>
          {smart ? (
            <ListRow label="Smart alerts" meta="Up to three a day, for work worth acting on now">
              <ListSwitch
                label="Smart alerts"
                checked={draft.smartAlerts !== false}
                onChange={(on) => setDraft({ ...draft, smartAlerts: on })}
              />
            </ListRow>
          ) : null}
        </ListGroup>
        {smart ? (
          <GroupHint>
            Smart alerts start from the morning digest time and pick work worth acting on: due soon with no time, ready to
            start, idle for weeks, or an Inbox that waits. Needs smart suggestions.
          </GroupHint>
        ) : null}
      </div>
      <div>
        <ListGroup>
          <ListRow label="Quiet hours" meta={draft.quietHoursStart && draft.quietHoursEnd ? "No pings in between" : "Off"}>
            <TimeField
              variant="row"
              clearable
              placeholder="From"
              aria-label="Quiet hours start"
              value={draft.quietHoursStart}
              onChange={(quietHoursStart) => setDraft({ ...draft, quietHoursStart })}
            />
            <span aria-hidden className="text-xs text-muted-foreground">
              –
            </span>
            <TimeField
              variant="row"
              clearable
              placeholder="To"
              aria-label="Quiet hours end"
              value={draft.quietHoursEnd}
              onChange={(quietHoursEnd) => setDraft({ ...draft, quietHoursEnd })}
            />
          </ListRow>
        </ListGroup>
        <GroupHint>
          Server-side reminders and digests still appear in the notification center during quiet hours; push waits until
          quiet hours end.
        </GroupHint>
      </div>
      <div>
        <ListGroup>
          <ListRow label="Timezone">
            <TimezoneSelect variant="row" value={draft.timezone} onChange={(timezone) => setDraft({ ...draft, timezone })} />
          </ListRow>
        </ListGroup>
        <GroupHint>
          Digest times and quiet hours are read in this zone. It follows your working-hours timezone unless you set a
          different one here.
        </GroupHint>
      </div>
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

const START_AT_LOGIN = "start-at-login";

/** Desktop only: start Timely hidden in the tray at sign-in, so bots keep checking. */
function ThisComputerSettings() {
  const { instance } = useDesktopInstance();
  const setting = useDesktopSetting();
  const ref = useRef<HTMLElement>(null);
  const shown = instance !== null;

  // The upgraders' notice links here.
  useEffect(() => {
    if (shown && window.location.hash === `#${START_AT_LOGIN}`) ref.current?.scrollIntoView({ block: "start" });
  }, [shown]);

  if (!instance) return null;
  const row = loginItemRow(instance, instance.platform);
  return (
    <section id={START_AT_LOGIN} ref={ref} className="max-w-xl scroll-mt-6">
      <h2 className="text-base font-semibold">This computer</h2>
      <p className="mb-3 mt-1 text-sm text-muted-foreground">Timely runs your bots while it is open, even hidden in the tray.</p>
      <ListGroup>
        <ListRow label="Start when you sign in" meta={row.meta} icon={<Power aria-hidden className={rowIcon} />}>
          <ListSwitch
            label="Start Timely when you sign in"
            checked={row.checked}
            disabled={row.disabled || setting.pending === "startAtLogin"}
            onChange={(on) =>
              void setting
                .set("startAtLogin", on)
                .catch((err: unknown) =>
                  useToastStore.getState().show(err instanceof Error ? err.message : "Couldn’t change start at sign-in."),
                )
            }
          />
        </ListRow>
      </ListGroup>
      {row.hint ? <GroupHint>{row.hint}</GroupHint> : null}
    </section>
  );
}

/** Where new bots alert (they save at once, unlike the form), what a bot push may say, and a way to the Bots page. */
function BotNotificationSettings() {
  const router = useRouter();
  const state = useAlertDefaults();
  const { defaults } = state;
  const settings = useNotificationSettings().data;
  const pushText = useSetPushTextHidden();
  const hidden = pushText.isPending ? pushText.variables : settings?.hidePushText === true;
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
      {settings ? (
        <>
          <ListGroup className="mt-4">
            <ListRow
              label="Hide alert text in push"
              meta={`Phones show “${HIDDEN_PUSH_BODY}”`}
              icon={<EyeOff aria-hidden className={rowIcon} />}
            >
              <ListSwitch
                label="Hide alert text in push"
                checked={hidden}
                disabled={pushText.isPending}
                onChange={(next) =>
                  pushText.mutate(next, { onError: (err) => useToastStore.getState().show(err.message) })
                }
              />
            </ListRow>
          </ListGroup>
          <GroupHint>
            Expo and Google carry what a push says. With this on, they only carry “{HIDDEN_PUSH_BODY}”; the alert opens in
            Timely.
          </GroupHint>
        </>
      ) : null}
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
