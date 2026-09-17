export function needsNetworkCopy(query: {
  isError: boolean;
  isPending: boolean;
  isFetching: boolean;
  fetchStatus?: string;
  data: unknown;
}) {
  const paused = query.fetchStatus === "paused";
  if (query.data != null) return null;
  if (query.isPending && query.isFetching && !paused) return null;
  if (query.isError || paused) {
    return "Timely needs a network connection to load this. Nothing is stored on this phone yet.";
  }
  return null;
}
