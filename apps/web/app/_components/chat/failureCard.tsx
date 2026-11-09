"use client";
import Link from "next/link";
import type { Chat } from "@/app/utils/api/chat";
import Button, { buttonClass } from "@/app/_components/_ui/button";
import { PROVIDER_NOT_CHOSEN } from "@timely/contract/helpMeWrite";
import {
  USE_CLASSIC_ACTION,
  USE_CLASSIC_LABEL,
} from "@timely/contract/agentChat";

/**
 * A failed run: what went wrong and the one thing that helps. A key, credit
 * or provider problem links to Agent settings, a failure that would repeat
 * offers no Try again, a run the new engine could not start offers "Use
 * classic for this chat" (Timely never switches engines on its own), and
 * photos still waiting for review can be discarded so the chat is never
 * stuck on them.
 */
export default function FailureCard({
  chat,
  needsProvider,
  pending,
  act,
  onUseClassic,
}: {
  chat: Chat;
  needsProvider: boolean;
  pending: boolean;
  act: (action: string, body?: unknown) => void;
  /** Switches this chat to the classic engine, then tries again. */
  onUseClassic: () => void;
}) {
  // The run waited for the person to choose a default provider (ADR 0020):
  // once one is chosen, the waiting chat can run, so Try again stays.
  const notChosen = chat.errorCode === PROVIDER_NOT_CHOSEN;
  const settings =
    needsProvider || notChosen || chat.errorAction === "settings";
  const stopped = ["failed", "stopped"].includes(chat.status);
  const retry =
    stopped &&
    !needsProvider &&
    (notChosen || (!settings && chat.errorAction !== "none"));
  // Photos that failed before their review opened; an open review has its
  // own Discard images button.
  const photos = stopped && chat.imageReview?.status === "extracting";
  const useClassic =
    stopped && !needsProvider && chat.errorAction === USE_CLASSIC_ACTION;
  return (
    <div
      role="alert"
      className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
    >
      <p className="font-medium text-destructive">
        {needsProvider
          ? "Connect an AI provider to chat"
          : notChosen
            ? "Choose a provider for chats"
            : settings
              ? "Check your AI provider"
              : useClassic
                ? "The new engine couldn't run this"
              : chat.errorAction === "none"
                ? "Couldn't finish this request"
                : "Something went wrong"}
      </p>
      <p className="mt-1 text-sm leading-6">{chat.error}</p>
      {(settings || retry || photos || useClassic) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {useClassic && (
            <Button size="sm" disabled={pending} onClick={onUseClassic}>
              {USE_CLASSIC_LABEL}
            </Button>
          )}
          {settings && (
            <Link
              href="/settings?tab=agent"
              className={buttonClass({ size: "sm" })}
            >
              {notChosen ? "Choose provider" : "Open Agent settings"}
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
