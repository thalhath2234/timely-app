import { Platform } from "react-native";
import { requireOptionalNativeModule, type NativeModule } from "expo";

export type BackEvent = {
  type: "started" | "progress" | "cancelled" | "invoked";
  /** 0 to 1 across the swipe. */
  progress: number;
  /** Past the threshold: letting go now goes back. */
  armed?: boolean;
  edge?: "left" | "right";
  touchY?: number;
};

export type LiveActionEvent = { id: string; data?: string | null };

/** One button on the live notification: `uri` opens the app there, otherwise JS gets `onLiveAction`. */
export type LiveButton = { id: string; label: string; uri?: string; data?: Record<string, unknown> };

export type LivePayload = {
  title: string;
  text: string;
  /** Expanded text, one line per running item. */
  bigText?: string;
  subText?: string;
  /** Short text for Android 16's status bar chip ("12:04", "2 runs"). */
  chip?: string;
  /** A clock the system draws: counting up from `base`, or down to it. */
  chronometer?: { base: number; countDown?: boolean };
  progress?: { max: number; value: number; indeterminate?: boolean };
  uri?: string;
  accent?: string;
  actions?: LiveButton[];
};

type Events = {
  onBack: (event: BackEvent) => void;
  onLiveAction: (event: LiveActionEvent) => void;
};

declare class TimelyAndroidNative extends NativeModule<Events> {
  setAppHandlesBack(handles: boolean): void;
  updateLiveActivity(payload: string): boolean;
  stopLiveActivity(): void;
  isLiveActivityRunning(): boolean;
  scheduleWidgetRefresh(atMs: number): void;
}

// Android only; Expo Go, iOS and web get no module and every call is a no-op.
const native = Platform.OS === "android" ? requireOptionalNativeModule<TimelyAndroidNative>("TimelyAndroid") : null;

export function hasTimelyAndroid() {
  return native !== null;
}

/** False at the root, so Android can play its back-to-home preview. */
export function setAppHandlesBack(handles: boolean) {
  native?.setAppHandlesBack(handles);
}

export function addBackListener(listener: (event: BackEvent) => void) {
  const sub = native?.addListener("onBack", listener);
  return () => sub?.remove();
}

export function updateLiveActivity(payload: LivePayload) {
  return native?.updateLiveActivity(JSON.stringify(payload)) ?? false;
}

export function stopLiveActivity() {
  native?.stopLiveActivity();
}

export function isLiveActivityRunning() {
  return native?.isLiveActivityRunning() ?? false;
}

export function addLiveActionListener(listener: (event: LiveActionEvent) => void) {
  const sub = native?.addListener("onLiveAction", listener);
  return () => sub?.remove();
}

/** Redraws the home screen widgets at `atMs` (epoch ms), e.g. when a widget's timer ends; 0 cancels. */
export function scheduleWidgetRefresh(atMs: number) {
  native?.scheduleWidgetRefresh(atMs);
}
