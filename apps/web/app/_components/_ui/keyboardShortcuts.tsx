"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import { tasksKey, useUpdateTask } from "@/app/utils/hooks/tasks";
import { showUndoToast } from "@/app/_store/toastStore";
import type { Task } from "@/app/_types/types";

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export default function KeyboardShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const setAddNewMode = useSidebarStore((state) => state.setAddNewMode);
  const setIsAddItemModalOpen = useSidebarStore((state) => state.setIsAddItemModalOpen);
  const setSearchMode = useSidebarStore((state) => state.setSearchMode);
  const updateTask = useUpdateTask();
  const queryClient = useQueryClient();
  const awaitingGo = useRef(false);
  const goTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (document.querySelector('[role="dialog"]')) return;

      const key = event.key.toLowerCase();

      if (awaitingGo.current) {
        awaitingGo.current = false;
        if (goTimer.current) clearTimeout(goTimer.current);
        const routes: Record<string, string> = {
          t: "/tasks",
          p: "/projects",
          c: "/calendar",
          d: "/docs",
          s: "/sheets",
          r: "/report",
          i: "/inbox",
          y: "/today",
          n: "/notifications",
        };
        const next = routes[key];
        if (next) {
          event.preventDefault();
          router.push(next);
        }
        return;
      }

      if (key === "g") {
        event.preventDefault();
        awaitingGo.current = true;
        goTimer.current = setTimeout(() => {
          awaitingGo.current = false;
        }, 800);
        return;
      }

      if (key === "c" && pathname.startsWith("/inbox")) {
        // On the Inbox, C means "capture": focus the quick-capture field the
        // page documents instead of opening the full task modal.
        const capture = document.querySelector<HTMLInputElement>("[data-inbox-capture]");
        if (capture) {
          event.preventDefault();
          capture.focus();
          return;
        }
      }

      if (key === "c" || key === "n") {
        event.preventDefault();
        setAddNewMode("task");
        setIsAddItemModalOpen(true);
        return;
      }

      if (key === "/") {
        event.preventDefault();
        setSearchMode(true);
        return;
      }

      if (key === "x") {
        const taskId = searchParams.get("taskId");
        if (!taskId || !pathname.startsWith("/tasks")) return;
        event.preventDefault();
        // Snapshot what the task had so Undo restores its own status rather
        // than whatever the workspace default happens to be.
        const cached = queryClient
          .getQueryData<Task[]>(tasksKey)
          ?.find((task) => task.id === taskId);
        const previous: { completedAt: string; statusId?: string } = {
          completedAt: cached?.completedAt ?? "",
        };
        if (cached?.status?.id || cached?.statusId) {
          previous.statusId = cached.status?.id ?? cached.statusId ?? undefined;
        }
        void updateTask
          .mutateAsync({ id: taskId, completedAt: new Date().toISOString() })
          .then(() => {
            showUndoToast("Task completed", () => {
              void updateTask.mutateAsync({ id: taskId, ...previous });
            });
          });
      }

      if (key === "s" && pathname.startsWith("/tasks")) {
        const taskId = searchParams.get("taskId");
        if (!taskId) return;
        event.preventDefault();
        router.push(`/calendar?taskId=${encodeURIComponent(taskId)}`);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (goTimer.current) clearTimeout(goTimer.current);
    };
  }, [
    pathname,
    router,
    searchParams,
    setAddNewMode,
    setIsAddItemModalOpen,
    setSearchMode,
    updateTask,
    queryClient,
  ]);

  return null;
}
