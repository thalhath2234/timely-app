"use client";
import Link from "next/link";
import type { Chat } from "@/app/utils/api/chat";
import Button, { buttonClass } from "@/app/_components/_ui/button";

/**
 * A failed run: what went wrong and the one thing that helps. A key, credit
 * or provider problem links to Agent settings, a failure that would repeat
 * offers no Try again, and photos still waiting for review can be discarded
 * so the chat is never stuck on them.
 */
export default function FailureCard({
  chat,
  needsProvider,
  pending,
  act,
}: {
  chat: Chat;
  needsProvider: boolean;
  pending: boolean;
  act: (action: string, body?: unknown) => void;
}) {
  const settings = needsProvider || chat.errorAction === "settings";
  const stopped = ["failed", "stopped"].includes(chat.status);
  const retry = stopped && !settings && chat.errorAction !== "none";
  // Photos that failed before their review opened; an open review has its
  // own Discard images button.
  const photos = stopped && chat.imageReview?.status === "extracting";
  return (
    <div
      role="alert"
      className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
    >
      <p className="font-medium text-destructive">
        {needsProvider
          ? "Connect an AI provider to chat"
          : settings
            ? "Check your AI provider"
            : chat.errorAction === "none"
              ? "Couldn't finish this request"
              : "Something went wrong"}
      </p>
      <p className="mt-1 text-sm leading-6">{chat.error}</p>
      {(settings || retry || photos) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {settings && (
            <Link
              href="/settings?tab=agent"
              className={buttonClass({ size: "sm" })}
            >
              Open Agent settings
            </Link>
          )}
          {retry && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => act("/retry")}
            >
              Try again
            </Button>
          )}
          {photos && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => act("/images/discard")}
            >
              Discard images
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
