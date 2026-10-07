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
}

/** Every `Category` the API writes (`models/notification.go`, chat service). */
export type NotificationCategory =
  | "reminder"
  | "digest"
  | "planning"
  | "overdue"
  | "missed"
  | "start"
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
  lockedBy?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobHealth {
  pending: number;
  running: number;
  failed: number;
  succeededLastHour: number;
}
