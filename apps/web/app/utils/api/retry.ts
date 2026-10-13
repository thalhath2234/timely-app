// The desktop app's web server restarts itself when its memory runs high
// (electron/supervisor/next.ts), and its API restarts when a server setting
// changes. Either leaves a few seconds where requests never reach the API:
// the fetch fails outright, or the proxy answers 502. Requests that do the
// same thing when sent twice are retried through that gap; the rest (POST,
// PATCH: creating things, sending a chat message) fail as before, so a
// retry can never repeat them.

/** Waits before each retry: 7.5 s in all, longer than a restart takes. */
export const RETRY_DELAYS_MS = [500, 1000, 2000, 4000];

const REPEATABLE = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);

/** The proxy's answer when the API did not answer (app/api-proxy); the API itself never sends it. */
const GAP_STATUS = 502;

/** Whether a request may be sent again: its method repeats safely and its body can be re-read. */
export function isRepeatable(init: { method?: string; body?: unknown; signal?: AbortSignal | null }): boolean {
  const method = (init.method ?? "GET").toUpperCase();
  if (!REPEATABLE.has(method)) return false;
  if (typeof ReadableStream !== "undefined" && init.body instanceof ReadableStream) return false;
  return !init.signal?.aborted;
}

/** Whether an attempt hit the restart gap: a network error (not an abort) or the proxy's 502. */
export function hitRestartGap(outcome: { response?: { status: number }; error?: unknown }): boolean {
  if (outcome.response) return outcome.response.status === GAP_STATUS;
  return outcome.error instanceof TypeError;
}

/**
 * Runs `attempt`, and again after each of `delays` while it hits the restart
 * gap. The last outcome is returned or thrown as is. An aborted `signal`
 * stops the waiting.
 */
export async function withRestartRetry(
  attempt: () => Promise<Response>,
  options: { delays?: number[]; signal?: AbortSignal | null; sleep?: (ms: number) => Promise<void> } = {},
): Promise<Response> {
  const delays = options.delays ?? RETRY_DELAYS_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let index = 0; ; index += 1) {
    let response: Response | undefined;
    let error: unknown;
    try {
      response = await attempt();
    } catch (caught) {
      error = caught;
    }
    const last = index >= delays.length || options.signal?.aborted;
    if (last || !hitRestartGap({ response, error })) {
      if (response) return response;
      throw error;
    }
    void response?.body?.cancel().catch(() => undefined);
    await sleep(delays[index]);
  }
}
