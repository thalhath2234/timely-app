"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useToastStore } from "@/app/_store/toastStore";
import { useDesktopBridge, useDesktopInstance } from "@/app/utils/hooks/desktop";

const LOGIN_NOTICE = "Timely now starts when you sign in so your bots keep watching. Turn off in Settings";
const START_AT_LOGIN_HREF = "/settings?tab=notifications#start-at-login";

/**
 * The one-time notice for people who had Timely before it started at login.
 * It waits until this window is seen (visible and focused), so a window kept
 * in the tray never uses it up unseen, and only the window the supervisor
 * answers `cleared: true` shows it, so it appears once across windows and
 * reloads.
 */
export default function LoginItemNotice() {
  const router = useRouter();
  const bridge = useDesktopBridge();
  const { instance } = useDesktopInstance();
  const owed = !!instance?.loginItem.notice && !!instance.settings.setupDone;
  const asked = useRef(false);

  useEffect(() => {
    if (!owed || !bridge || asked.current) return;
    const tryShow = () => {
      if (asked.current || document.visibilityState !== "visible" || !document.hasFocus()) return;
      asked.current = true;
      stop();
      void bridge
        .action("dismissLoginNotice")
        .then((result) => {
          if (!result.ok || result.cleared !== true) return;
          useToastStore.getState().show(
            LOGIN_NOTICE,
            {
              label: "Settings",
              onAction: () => {
                router.push(START_AT_LOGIN_HREF);
                // Already on Notifications: the section is there, so go to it.
                document.getElementById("start-at-login")?.scrollIntoView({ block: "start" });
              },
            },
            20_000,
          );
        })
        .catch(() => {
          // The notice stays owed; the next window or launch tries again.
          asked.current = false;
        });
    };
    const stop = () => {
      document.removeEventListener("visibilitychange", tryShow);
      window.removeEventListener("focus", tryShow);
    };
    document.addEventListener("visibilitychange", tryShow);
    window.addEventListener("focus", tryShow);
    tryShow();
    return stop;
  }, [owed, bridge, router]);

  return null;
}
