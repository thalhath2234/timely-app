import { useBotStream } from "../../lib/hooks";

/** Follows the bots live stream while signed in, so the Bots tab and its badge stay current. */
export default function BotLiveUpdates() {
  useBotStream();
  return null;
}
