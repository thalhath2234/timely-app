"use client";
import { useBotStream } from "@/app/utils/hooks/bots";

/** Keeps the Bots board and the bot panel live from GET /bots/watch. Renders nothing. */
export default function BotRuntime() {
  useBotStream();
  return null;
}
