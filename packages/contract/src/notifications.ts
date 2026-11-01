export interface NotificationSettings {
  reminders: boolean;
  digestMorning: boolean;
  digestEvening: boolean;
  planning: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  timezone: string;
  morningDigestAt: string;
  eveningDigestAt: string;
  /** Smart alerts: a few alerts a day for suggestions worth acting on (needs smart suggestions). */
  smartAlerts?: boolean;
}

/** Every `Category` the API writes (`models/notification.go`, chat service). */
export type NotificationCategory =
  | "reminder"
  | "digest"
  | "planning"
  | "overdue"
  | "missed"
  | "start"
  | "suggestion"
  | "agent";

export interface AppNotification {
  id: string;
  userId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
  data: Record<string, unknown>;
  dedupeKey?: string;
  readAt?: string;
  snoozedUntil?: string;
  deliveredAt?: string;
  createdAt: string;
}

export interface JobRecord {
  id: string;
  userId: string;
  kind: string;
  status: string;
  dedupeKey?: string;
  payload: Record<string, unknown>;
  runAt: string;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  lockedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

const jobKindLabels: Record<string, string> = {
  send_reminder: "Reminder",
  daily_digest: "Daily digest",
  overdue_task: "Overdue task alert",
  missed_block: "Missed time block alert",
  start_soon: "Starting soon alert",
  send_push: "Push notification",
  create_backup: "Backup",
  index_entity: "Search index update",
  reindex_user: "Search index rebuild",
  smart_alerts: "Smart alerts",
};

/** The name a person sees for a job kind; a kind added later reads as words. */
export function jobKindLabel(kind: string): string {
  const label = jobKindLabels[kind];
  if (label) return label;
  const words = kind.replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Job";
}

export interface JobHealth {
  pending: number;
  running: number;
  failed: number;
  succeededLastHour: number;
}
