/**
 * How often Settings → Agent asks again while the semantic-search rebuild
 * runs, so its count moves: every 2 s for the first minute, then every 15 s,
 * and not at all after 15 minutes, so a rebuild stuck as running is not asked
 * about for good. Each ask runs the whole provider overview on the server.
 * Other screens read the overview once and never poll it.
 */
export function reindexPollInterval(status: string | undefined, runningForMs: number): number | false {
  if (status !== "queued" && status !== "running") return false;
  if (runningForMs < 60_000) return 2000;
  return runningForMs < 15 * 60_000 ? 15_000 : false;
}
