// design-sync barrel: the Timely web app components shipped to claude.ai/design.
// Hand-maintained - add a line when a new component lands in apps/web/app/_components.
// Runtime plumbing (ClientRuntime, ChatRuntime, InlineScript, ReducedMotionGate,
// EntityDetailHost) is deliberately left out: it renders nothing a design can use.
import "./shims/env";

export { TimelyProvider, type TimelyProviderProps } from "./provider";
export { sampleApi } from "./sample";
export type { TimelyMockApi, MockRequest, MockHandler } from "./mockApi";
export { useToastStore } from "@/app/_store/toastStore";
export { requestConfirm } from "@/app/_store/confirmStore";
export { useContextMenuStore } from "@/app/_store/contextMenuStore";

// _layout
export { default as AppShell } from "@/app/_components/_layout/appShell";
export { default as Sidebar } from "@/app/_components/_layout/sidebar";

// _ui
export { default as ColorChip } from "@/app/_components/_ui/colorChip";
export { default as ColorPicker } from "@/app/_components/_ui/colorPicker";
export { default as ConfirmDialog } from "@/app/_components/_ui/confirmDialog";
export { default as ConfirmHost } from "@/app/_components/_ui/confirmHost";
export { default as ContextMenuHost } from "@/app/_components/_ui/contextMenu";
export { default as CustomFieldControl } from "@/app/_components/_ui/customFieldControl";
export { default as DatePicker, DateField, TimeField, DateTimeField } from "@/app/_components/_ui/datePicker";
export { default as EmptyState } from "@/app/_components/_ui/emptyState";
export { default as ExpandCollapsedListButton } from "@/app/_components/_ui/expandCollapsedListButton";
export { default as KeyboardShortcuts } from "@/app/_components/_ui/keyboardShortcuts";
export { default as LabelPicker } from "@/app/_components/_ui/labelPicker";
export { default as LoadError, LoadErrorBanner, QueryFailure } from "@/app/_components/_ui/loadError";

// _ui/modal
export { default as AddItemModal } from "@/app/_components/_ui/modal/addItem";
export { EntityModalShell, ModalMain, ModalSidebar, PropertyRow, SidebarSectionTitle } from "@/app/_components/_ui/modal/entityModal";
export { default as SearchModal } from "@/app/_components/_ui/modal/search";

// _ui
export { OverlayScrim, OverlayPanel, PopoverView, PageFade } from "@/app/_components/_ui/motion";
export { default as RecurrenceEditor } from "@/app/_components/_ui/recurrenceEditor";
export { default as SaveStatusBadge } from "@/app/_components/_ui/saveStatus";
export { default as Select } from "@/app/_components/_ui/select";
export { default as SidebarButton, SidebarButtonIcon } from "@/app/_components/_ui/sidebarButton";

// _ui/tasks
export { default as BulkActionBar } from "@/app/_components/_ui/tasks/bulkActionBar";
export { default as EntityDetailPanel } from "@/app/_components/_ui/tasks/entityDetailPanel";
export { default as GanttView } from "@/app/_components/_ui/tasks/ganttView";
export { default as KanbanView } from "@/app/_components/_ui/tasks/kanbanView";
export { default as ProjectTaskList } from "@/app/_components/_ui/tasks/projectTaskList";
export { default as TaskExecution } from "@/app/_components/_ui/tasks/taskExecution";
export { default as TaskScheduleSection } from "@/app/_components/_ui/tasks/taskScheduleSection";
export { TaskToolbar, TaskOptionsBar, TaskListStatusBar } from "@/app/_components/_ui/tasks/taskToolbar";
export { default as TaskTypeToggle } from "@/app/_components/_ui/tasks/taskTypeToggle";
export { default as TasksTable } from "@/app/_components/_ui/tasks/tasktable";

// _ui
export { default as TimezoneSelect } from "@/app/_components/_ui/timezoneSelect";
export { default as ToastHost } from "@/app/_components/_ui/toastHost";
export { CreateLabelInline, CreateCustomFieldInline } from "@/app/_components/_ui/workspaceQuickCreate";

// calendarView
export { default as AgendaView } from "@/app/_components/calendarView/agendaView";
export { default as AutoScheduleDialog } from "@/app/_components/calendarView/autoScheduleDialog";
export { default as AutoScheduleIndicator } from "@/app/_components/calendarView/autoScheduleIndicator";
export { default as DayView } from "@/app/_components/calendarView/dayView";
export { default as EventDialog } from "@/app/_components/calendarView/eventDialog";
export { default as MonthView } from "@/app/_components/calendarView/monthView";
export { default as ScheduleDialog } from "@/app/_components/calendarView/scheduleDialog";
export { default as TimeGrid } from "@/app/_components/calendarView/timeGrid";
export { default as WaitingForSlotRail } from "@/app/_components/calendarView/waitingForSlotRail";
export { default as WeekView } from "@/app/_components/calendarView/weekView";

// chat
export { Value as ChangeValue, default as ChangeCards } from "@/app/_components/chat/changeCards";
export { default as ChatText } from "@/app/_components/chat/chatText";
export { ContextChips, default as Composer } from "@/app/_components/chat/composer";
export { StatusPill, default as Conversation } from "@/app/_components/chat/conversation";
export { default as EmptyHero } from "@/app/_components/chat/emptyHero";
export { ImagePreview, PendingImages } from "@/app/_components/chat/imageAttachments";
export { default as MessageList } from "@/app/_components/chat/messageList";
export { default as ProposalPanel } from "@/app/_components/chat/proposalPanel";
export { ReceiptSummary, default as ReceiptReview } from "@/app/_components/chat/receiptReview";

// docs
export { default as DocList } from "@/app/_components/docs/docList";

// editor
export { default as CodeBlockView } from "@/app/_components/editor/codeBlockView";
export { default as RichTextEditor } from "@/app/_components/editor/richTextEditor";
export { OPEN_LINK_EDITOR_EVENT } from "@/app/_components/editor/slashMenu";

// landing
export { default as FeatureIndex } from "@/app/_components/landing/featureIndex";
export { default as GitHubMark } from "@/app/_components/landing/githubMark";
export { default as LandingHeader } from "@/app/_components/landing/header";
export { default as LoopNav } from "@/app/_components/landing/loopNav";
export { EventBlocks, MiniWeek } from "@/app/_components/landing/miniWeek";
export { default as QuickStart } from "@/app/_components/landing/quickStart";
export { SceneBox, MiniWindow, SceneButton, Typed, Caret, CountUp } from "@/app/_components/landing/scene";

// landing/scenes
export { default as AssistantScene } from "@/app/_components/landing/scenes/assistantScene";
export { default as AutoScheduleScene } from "@/app/_components/landing/scenes/autoScheduleScene";
export { default as CaptureScene } from "@/app/_components/landing/scenes/captureScene";
export { default as ClarifyScene } from "@/app/_components/landing/scenes/clarifyScene";
export { default as DocsSheetsScene } from "@/app/_components/landing/scenes/docsSheetsScene";
export { default as EverywhereScene } from "@/app/_components/landing/scenes/everywhereScene";
export { default as FocusScene } from "@/app/_components/landing/scenes/focusScene";
export { default as HeroScene } from "@/app/_components/landing/scenes/heroScene";
export { default as ReviewScene } from "@/app/_components/landing/scenes/reviewScene";
export { default as SearchScene } from "@/app/_components/landing/scenes/searchScene";

// landing
export { Stage as LandingStage, Section as LandingSection } from "@/app/_components/landing/section";
export { Sticker, Shape as StickerShape } from "@/app/_components/landing/stickers";
export { default as ThemeToggle } from "@/app/_components/landing/themeToggle";

// projects
export { default as StageBoard } from "@/app/_components/projects/stageBoard";
export { default as StageCatalog } from "@/app/_components/projects/stageCatalog";

// settings
export { default as AccountSettings } from "@/app/_components/settings/accountSettings";
export { ModelPicker, default as AgentSettings } from "@/app/_components/settings/agentSettings";
export { default as ApiKeysSettings } from "@/app/_components/settings/apiKeysSettings";
export { default as AppearanceSettings } from "@/app/_components/settings/appearanceSettings";
export { default as CustomFieldEditor } from "@/app/_components/settings/customFieldEditor";
export { default as DataSettings } from "@/app/_components/settings/dataSettings";
export { default as NamedColorEditor } from "@/app/_components/settings/namedColorEditor";
export { default as NotificationSettingsPanel } from "@/app/_components/settings/notificationSettings";
export { default as WorkingHoursSettings } from "@/app/_components/settings/workingHoursSettings";
export { default as WorkspaceSettings } from "@/app/_components/settings/workspaceSettings";

// sheets
export { default as SheetGrid } from "@/app/_components/sheets/sheetGrid";
export { default as SheetList } from "@/app/_components/sheets/sheetList";

// today
export { default as TodayDashboard } from "@/app/_components/today/todayDashboard";
