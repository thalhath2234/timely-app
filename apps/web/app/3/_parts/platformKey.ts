"use client";

import { useSyncExternalStore } from "react";

function isMac() {
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform;
  return /mac|iphone|ipad/i.test(platform);
}

const noop = () => () => undefined;

/** "Ctrl" everywhere except Apple keyboards, where it reads "⌘". Server renders "Ctrl". */
export function useModKey() {
  return useSyncExternalStore(noop, () => (isMac() ? "⌘" : "Ctrl"), () => "Ctrl");
}
