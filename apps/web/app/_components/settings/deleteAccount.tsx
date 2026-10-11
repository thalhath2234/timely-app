"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { OverlayFrame, OverlayPanel, OverlayScrim } from "@/app/_components/_ui/motion";
import { deleteMe } from "@/app/utils/api/user";
import { setAccessToken } from "@/app/utils/api/client";
import { useDesktopBridge } from "@/app/utils/hooks/desktop";

const CONFIRM_WORD = "DELETE";

// Per-device state that belongs to the account (open doc tabs, timers); the
// theme and layout preferences stay with the computer.
const ACCOUNT_STORAGE_KEYS = ["timely.pageTabs", "timely.report.pomodoro", "timely.staleReview.hiddenUntil"];

const inputClass =
  "w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-1 focus:ring-ring";

/** Settings → Account: deletes the account and its data. Only the desktop app
 * shows it, since there the account lives in the computer's own database. */
export default function DeleteAccountSection({ email }: { email: string }) {
  const desktop = useDesktopBridge();
  const [open, setOpen] = useState(false);
  if (!desktop) return null;

  return (
    <section className="mt-8 flex max-w-lg flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-foreground">Delete account</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Permanently remove this account and everything in it from this computer.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-3">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          Want a copy first?{" "}
          <Link href="/settings?tab=data" className="font-medium text-foreground underline-offset-2 hover:underline">
            Export your data
          </Link>{" "}
          before you delete.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 rounded-lg bg-destructive-container px-3 py-1.5 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive-container/90"
        >
          Delete account…
        </button>
      </div>
      {open ? <DeleteAccountDialog email={email} onCancel={() => setOpen(false)} /> : null}
    </section>
  );
}

function DeleteAccountDialog({ email, onCancel }: { email: string; onCancel: () => void }) {
  const desktop = useDesktopBridge();
  const queryClient = useQueryClient();
  const titleId = useId();
  const descriptionId = useId();
  const confirmRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState("");
  const [password, setPassword] = useState("");

  const remove = useMutation({
    mutationFn: () => deleteMe({ password }),
    onSuccess: async (result) => {
      setAccessToken(null);
      queryClient.clear();
      try {
        for (const key of ACCOUNT_STORAGE_KEYS) window.localStorage.removeItem(key);
      } catch {
        // storage can be unavailable; nothing account-wide is lost
      }
      // With no account left the computer starts over, setup wizard included.
      if (result.lastAccount && desktop) {
        await desktop.setSetting("setupDone", false).catch(() => undefined);
      }
      // A full load drops every in-memory store along with the cache.
      window.location.replace(result.registrationOpen ? "/signup" : "/login");
    },
  });
  const pending = remove.isPending || remove.isSuccess;
  const ready = typed.trim() === CONFIRM_WORD && password.length > 0 && !pending;

  useEffect(() => {
    confirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (!pending) onCancel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel, pending]);

  // Same as ConfirmDialog: the pointer lands on Cancel, never on Delete.
  useEffect(() => {
    const button = cancelRef.current;
    const snapPointer = window.timelyDesktop?.snapPointer;
    if (!button || !snapPointer) return;
    const rect = button.getBoundingClientRect();
    snapPointer(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, []);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) remove.mutate();
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <OverlayScrim
        className="z-[70] bg-black/55"
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget || pending) return;
          onCancel();
        }}
      />
      <OverlayFrame className="z-[70] items-center justify-center p-4">
        <OverlayPanel
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className="relative w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <form onSubmit={onSubmit}>
            <div className="flex gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                <TriangleAlert className="size-4" />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <h2 id={titleId} className="text-sm font-semibold text-foreground">
                  Delete your account?
                </h2>
                <div id={descriptionId} className="mt-1 flex flex-col gap-2 text-sm leading-snug text-muted-foreground">
                  <p>
                    This deletes <span className="font-medium text-foreground">{email}</span> and everything in it
                    from this computer: tasks, projects, docs, sheets, calendar, habits, goals, chats, API keys and
                    the account&apos;s backups. Every device signed in to it, your phone included, is signed out.
                  </p>
                  <p className="font-medium text-destructive">This can&apos;t be undone.</p>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  Type <span className="font-mono font-semibold text-foreground">{CONFIRM_WORD}</span> to confirm
                </span>
                <input
                  ref={confirmRef}
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={pending}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  disabled={pending}
                  className={inputClass}
                />
              </label>
              {remove.isError ? (
                <p role="alert" className="text-xs text-destructive">
                  {remove.error instanceof Error ? remove.error.message : "Could not delete the account."}
                </p>
              ) : null}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={cancelRef}
                type="button"
                onClick={onCancel}
                disabled={pending}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!ready}
                className="rounded-lg bg-destructive-container px-3 py-1.5 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive-container/90 disabled:opacity-50"
              >
                {pending ? "Deleting…" : "Delete account"}
              </button>
            </div>
          </form>
        </OverlayPanel>
      </OverlayFrame>
    </>,
    document.body,
  );
}
