import type {
  ApiKey,
  AppNotification,
  JobHealth,
  JobRecord,
  NotificationSettings,
  ScheduleSettings,
} from "@/app/_types/types";
import type { AgentProviders, ModelOption, ProviderId } from "@/app/utils/api/agentProviders";
import type { BackupFile, BackupSettings } from "@/app/utils/api/portability";
import type { DeviceSession } from "@/app/utils/api/user";
import { browserTimezone, type Clock } from "./clock";
import { T } from "./tasks";
import { USER_ID, WS_PERSONAL } from "./workspace";

export function buildSessions(clock: Clock): DeviceSession[] {
  const { iso, ago } = clock;
  return [
    { id: "ses_mac", deviceLabel: "Chrome on macOS", createdAt: iso(-21, 9, 2), lastUsedAt: ago(1), expiresAt: iso(9, 9, 2), current: true },
    { id: "ses_desktop", deviceLabel: "Timely Desktop on macOS", createdAt: iso(-40, 8, 50), lastUsedAt: ago(60 * 3), expiresAt: iso(20, 8, 50), current: false },
    { id: "ses_phone", deviceLabel: "Timely on iPhone", createdAt: iso(-60, 19, 15), lastUsedAt: ago(60 * 14), expiresAt: iso(5, 19, 15), current: false },
  ];
}

export function buildApiKeys(clock: Clock): ApiKey[] {
  const { iso, ago } = clock;
  return [
    { id: "key_raycast", userId: USER_ID, name: "Raycast quick capture", prefix: "tml_7Hq2", lastUsedAt: ago(60 * 5), createdAt: iso(-45, 10, 0) },
    { id: "key_mcp", userId: USER_ID, name: "Claude Desktop (MCP)", prefix: "tml_c9Lx", lastUsedAt: ago(60 * 26), createdAt: iso(-18, 14, 30) },
    { id: "key_shortcuts", userId: USER_ID, name: "iOS Shortcuts", prefix: "tml_Pw3e", lastUsedAt: null, createdAt: iso(-3, 21, 10) },
  ];
}

export function buildBackupSettings(clock: Clock): BackupSettings {
  return { enabled: true, intervalDays: 1, retentionCount: 7, nextRunAt: clock.iso(1, 3, 0) };
}

export function buildBackups(clock: Clock): BackupFile[] {
  const { iso } = clock;
  return [0, -1, -2, -3].map((day, i) => ({
    id: `bak_${i + 1}`,
    byteSize: 2_481_920 - i * 18_432,
    checksum: ["9f2c41e0b7a3", "4be8d10c55f2", "e71a03c9d84b", "1c5f7ea2903d"][i],
    createdAt: iso(day, 3, 0),
  }));
}

export function buildAgentProviders(clock: Clock): AgentProviders {
  const { ago } = clock;
  return {
    defaultProvider: "claude",
    localCli: true,
    openrouter: {
      keySet: true,
      keyHint: "sk-or-…4f2a",
      chatModel: "anthropic/claude-sonnet-4.5",
      embedModel: "openai/text-embedding-3-small",
      ready: true,
    },
    claude: {
      enabled: true,
      status: { found: true, path: "/opt/homebrew/bin/claude", version: "2.1.4", loggedIn: true, account: "maya.chen@hey.com", checkedAt: ago(2) },
      connected: true,
      connectedAt: ago(60 * 24 * 12),
      model: "sonnet",
      ready: true,
    },
    codex: {
      enabled: true,
      status: { found: false, loggedIn: false, error: "codex was not found on PATH", checkedAt: ago(2) },
      connected: false,
      model: "",
      ready: false,
    },
    reindex: { status: "done", done: 214, total: 214, updatedAt: ago(60 * 6) },
  };
}

export function providerModels(id: ProviderId, kind: string | null): ModelOption[] {
  if (id === "claude") {
    return [
      { id: "fable", name: "Fable (latest)", vision: true, note: "Most capable" },
      { id: "opus", name: "Opus (latest)", vision: true },
      { id: "sonnet", name: "Sonnet (latest)", vision: true, default: true, note: "Balanced" },
      { id: "haiku", name: "Haiku (latest)", vision: true, note: "Fastest" },
    ];
  }
  if (id === "codex") {
    return [
      { id: "gpt-5-codex", name: "GPT-5 Codex", vision: true, default: true },
      { id: "gpt-5", name: "GPT-5", vision: true },
    ];
  }
  if (kind === "embed") {
    return [
      { id: "openai/text-embedding-3-small", name: "OpenAI: Text Embedding 3 Small", vision: false, default: true },
      { id: "openai/text-embedding-3-large", name: "OpenAI: Text Embedding 3 Large", vision: false },
    ];
  }
  return [
    { id: "anthropic/claude-sonnet-4.5", name: "Anthropic: Claude Sonnet 4.5", vision: true, default: true },
    { id: "anthropic/claude-haiku-4.5", name: "Anthropic: Claude Haiku 4.5", vision: true },
    { id: "google/gemini-2.5-pro", name: "Google: Gemini 2.5 Pro", vision: true },
    { id: "openai/gpt-5", name: "OpenAI: GPT-5", vision: true },
  ];
}

export function buildNotifications(clock: Clock): AppNotification[] {
  const { ago, iso, earlierToday } = clock;
  const n = (row: Partial<AppNotification> & Pick<AppNotification, "id" | "category" | "title" | "body" | "createdAt">): AppNotification => ({
    userId: USER_ID,
    entityType: null,
    entityId: null,
    data: {},
    readAt: null,
    snoozedUntil: null,
    deliveredAt: row.createdAt,
    ...row,
  });
  return [
    n({
      id: "ntf_start_soon",
      category: "reminder",
      title: "Starting soon: Wireframe the 3-step welcome flow",
      body: "Your focus block starts in 10 minutes and runs for 1h 30m.",
      entityType: "task",
      entityId: T.wireframe,
      createdAt: ago(18),
    }),
    n({
      id: "ntf_overdue_tokens",
      category: "overdue",
      title: "Overdue: Define spacing and radius tokens",
      body: "This was due 2 days ago. It has a block today at 1:30 PM.",
      entityType: "task",
      entityId: T.tokens,
      createdAt: earlierToday(240),
    }),
    n({
      id: "ntf_morning_digest",
      category: "digest",
      title: "Your day: 3 meetings, 2 focus blocks",
      body: "Standup, 1:1 with Priya and the onboarding critique. 3h of focused work is scheduled.",
      createdAt: earlierToday(300),
      readAt: earlierToday(290),
    }),
    n({
      id: "ntf_planning",
      category: "planning",
      title: "2 tasks don't fit before their deadlines",
      body: "\"Fix focus ring inconsistencies\" and \"Renew passport\" have no time reserved. Review the plan?",
      createdAt: iso(-1, 17, 45),
    }),
    n({
      id: "ntf_overdue_focus",
      category: "overdue",
      title: "Overdue: Fix focus ring inconsistencies in form inputs",
      body: "This was due yesterday and is marked Blocked.",
      entityType: "task",
      entityId: T.focusRing,
      createdAt: iso(-1, 9, 0),
      readAt: iso(-1, 9, 12),
    }),
    n({
      id: "ntf_weekly_update",
      category: "reminder",
      title: "Post the weekly design update in #design",
      body: "Repeats every Friday at 4:00 PM.",
      entityType: "task",
      entityId: T.weeklyUpdate,
      createdAt: iso(-3, 16, 0),
      readAt: iso(-3, 16, 20),
    }),
  ];
}

export function buildNotificationSettings(): NotificationSettings {
  return {
    reminders: true,
    digestMorning: true,
    digestEvening: false,
    planning: true,
    quietHoursStart: "21:30",
    quietHoursEnd: "07:30",
    timezone: browserTimezone(),
    morningDigestAt: "08:00",
    eveningDigestAt: "18:00",
  };
}

export function buildJobs(clock: Clock): JobRecord[] {
  const { ago, iso } = clock;
  const job = (row: Partial<JobRecord> & Pick<JobRecord, "id" | "kind" | "status" | "runAt">): JobRecord => ({
    userId: USER_ID,
    attempts: 1,
    maxAttempts: 5,
    payload: {},
    lastError: null,
    createdAt: row.runAt,
    updatedAt: row.runAt,
    ...row,
  });
  return [
    job({ id: "job_digest", kind: "daily_digest", status: "succeeded", runAt: iso(0, 8, 0) }),
    job({ id: "job_start_soon", kind: "start_soon", status: "succeeded", runAt: ago(18), payload: { taskId: T.wireframe } }),
    job({ id: "job_index", kind: "index_entity", status: "succeeded", runAt: ago(35), payload: { kind: "doc", id: "doc_weekly_notes" } }),
    job({
      id: "job_push_failed",
      kind: "send_push",
      status: "failed",
      runAt: ago(60 * 7),
      attempts: 5,
      lastError: "push endpoint returned 410 Gone (subscription expired)",
      payload: { notificationId: "ntf_overdue_tokens" },
    }),
    job({ id: "job_backup", kind: "create_backup", status: "pending", runAt: iso(1, 3, 0), attempts: 0 }),
    job({ id: "job_reminder", kind: "send_reminder", status: "pending", runAt: iso(0, 17, 15), attempts: 0, payload: { taskId: T.dentist } }),
  ];
}

export function buildJobHealth(jobs: JobRecord[]): JobHealth {
  const count = (status: string) => jobs.filter((job) => job.status === status).length;
  return { pending: count("pending"), running: count("running"), failed: count("failed"), succeededLastHour: 2 };
}

export function buildScheduleSettings(): ScheduleSettings {
  return { breakMinutes: 10, freezeHours: 2, excludedWorkspaceIds: [WS_PERSONAL] };
}
