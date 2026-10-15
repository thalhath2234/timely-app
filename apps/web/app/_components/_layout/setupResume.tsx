"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useDesktopInstance } from "@/app/utils/hooks/desktop";

const RESUMED_KEY = "timely-setup-resumed";

/** The desktop first-run setup only ends with Finish. If the app was closed
 * (or left) before that, the next launch picks it up again, once per window,
 * so Settings and the rest of the app stay reachable afterwards. */
export default function SetupResume() {
  const router = useRouter();
  const { instance } = useDesktopInstance();
  const pending = instance !== null && !instance.settings.setupDone;

  useEffect(() => {
    if (!pending) return;
    try {
      if (window.sessionStorage.getItem(RESUMED_KEY)) return;
      window.sessionStorage.setItem(RESUMED_KEY, "1");
    } catch {
      return;
    }
    router.replace("/setup");
  }, [pending, router]);

  return null;
}
