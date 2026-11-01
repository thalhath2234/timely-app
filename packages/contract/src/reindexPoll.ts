/**
 * How often Settings → Agent asks again while the semantic-search rebuild
 * runs, so its count moves: every 2 s for the first minute, then every 15 s,
 * and not at all after 15 minutes, so a rebuild stuck as running is not asked
 * about for good. A rebuild "retrying" (a try failed, the queue tries again
 * after a pause) is asked about every 5 s at first, as it changes less often.
 * Each ask runs the whole provider overview on the server. Other screens read
 * the overview once and never poll it.
 */
export function reindexPollInterval(status: string | undefined, runningForMs: number): number | false {
  if (!reindexActive(status)) return false;
  if (runningForMs < 60_000) return status === "retrying" ? 5000 : 2000;
  return runningForMs < 15 * 60_000 ? 15_000 : false;
}

/** Whether a rebuild with this status is still on its way. */
export function reindexActive(status: string | undefined): boolean {
  return status === "queued" || status === "running" || status === "retrying";
}
