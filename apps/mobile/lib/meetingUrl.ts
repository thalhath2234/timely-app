/**
 * The first Google Meet, Zoom or Teams link in a piece of text, for Home's
 * "Join call" button. The host may carry a subdomain (us02web.zoom.us) but has
 * to be the link's own host, not a word in its path.
 */
const MEETING_URL =
  /https?:\/\/(?:[a-z0-9-]+\.)*(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com)(?=[/?#:\s]|$)[^\s<>"')\]]*/i;

export function findMeetingUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.match(MEETING_URL)?.[0] ?? null;
}
