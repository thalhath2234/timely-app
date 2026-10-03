import type {
  ApiKey,
  AppNotification,
  CalendarEventEntity,
  Config,
  Doc,
  JobRecord,
  Label,
  NotificationSettings,
  Project,
  ScheduleSettings,
  Sheet,
  SheetTemplate,
  Stage,
  Task,
  TaskActivity,
  User,
  Workspace,
} from "@/app/_types/types";
import type { AgentProviders } from "@/app/utils/api/agentProviders";
import type { Chat } from "@/app/utils/api/chat";
import type { BackupFile, BackupSettings } from "@/app/utils/api/portability";
import type { DeviceSession } from "@/app/utils/api/user";
import {
  buildAgentProviders,
  buildApiKeys,
  buildBackupSettings,
  buildBackups,
  buildJobs,
  buildNotificationSettings,
  buildNotifications,
  buildScheduleSettings,
  buildSessions,
} from "./account";
import { buildChats } from "./chats";
import { makeClock, type Clock } from "./clock";
import { buildDocs, buildSheetTemplates, buildSheets } from "./content";
import { T, buildEvents, buildTasks } from "./tasks";
import { buildConfig, buildProjects, buildStages, buildUser, buildWorkspaces } from "./workspace";

/** The mutable sample workspace one mock API instance serves. Write routes
 *  change it so a design's interactions read back consistently. */
export type Store = {
  clock: Clock;
  user: User;
  config: Config;
  workspaces: Workspace[];
  stages: Stage[];
  projects: Project[];
  tasks: Task[];
  events: CalendarEventEntity[];
  comments: TaskActivity[];
  docs: Doc[];
  sheets: Sheet[];
  templates: SheetTemplate[];
  chats: Chat[];
  notifications: AppNotification[];
  notificationSettings: NotificationSettings;
  jobs: JobRecord[];
  sessions: DeviceSession[];
  apiKeys: ApiKey[];
  backups: BackupFile[];
  backupSettings: BackupSettings;
  providers: AgentProviders;
  scheduleSettings: ScheduleSettings;
  seq: number;
};

export function createStore(now = new Date()): Store {
  const clock = makeClock(now);
  const comment = (id: string, taskId: string, message: string, createdAt: string): TaskActivity => ({
    id,
    taskId,
    userId: "usr_maya",
    actorName: "Maya Chen",
    action: "commented",
    message,
    createdAt,
  });
  return {
    clock,
    user: buildUser(),
    config: buildConfig(clock),
    workspaces: buildWorkspaces(clock),
    stages: buildStages(clock),
    projects: buildProjects(clock),
    tasks: buildTasks(clock),
    events: buildEvents(clock),
    comments: [
      comment("act_c1", T.wireframe, "Priya suggested trying the invite step before naming. Testing both orders in the critique.", clock.iso(-1, 16, 5)),
      comment("act_c2", T.wireframe, "Skip path is now visible on every step; resume state still missing.", clock.ago(50)),
      comment("act_c3", T.tokens, "Dev confirmed the grid can live with 4px and 8px - no need for 6px.", clock.iso(-1, 12, 40)),
      comment("act_c4", T.focusRing, "Blocked until the token review lands - the ring color depends on it.", clock.iso(-2, 10, 15)),
    ],
    docs: buildDocs(clock),
    sheets: buildSheets(clock),
    templates: buildSheetTemplates(clock),
    chats: buildChats(clock),
    notifications: buildNotifications(clock),
    notificationSettings: buildNotificationSettings(),
    jobs: buildJobs(clock),
    sessions: buildSessions(clock),
    apiKeys: buildApiKeys(clock),
    backups: buildBackups(clock),
    backupSettings: buildBackupSettings(clock),
    providers: buildAgentProviders(clock),
    scheduleSettings: buildScheduleSettings(),
    seq: 0,
  };
}

export function nextId(store: Store, prefix: string) {
  store.seq += 1;
  return `${prefix}_new_${store.seq}`;
}

export function allLabels(store: Store): Label[] {
  return store.workspaces.flatMap((workspace) => workspace.lables ?? []);
}
