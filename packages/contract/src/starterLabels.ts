/**
 * Onboarding's starter labels, split across the workspaces it creates.
 *
 * A workspace made with "Also create" for a use (Study, Health…) gets the
 * picked labels that fit that use. The first workspace gets the labels of
 * every other picked use; when each picked use has a workspace of its own it
 * gets them all, so it is never left with none. A label can land in several
 * workspaces (label names are only unique within one).
 */

export interface StarterLabelPick {
  name: string;
  color: string;
  /** Starter use keys the label fits; missing on an older API. */
  uses?: string[];
}

export interface StarterUseOption {
  key: string;
  workspace?: string;
}

export function splitStarterLabels<L extends StarterLabelPick>(
  labels: L[],
  picked: string[],
  options: StarterUseOption[],
  extras: string[],
): { first: L[]; extras: Record<string, L[]> } {
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const usesOf = (name: string) =>
    options.filter((u) => picked.includes(u.key) && u.workspace && same(u.workspace, name)).map((u) => u.key);
  const fits = (label: L, uses: string[]) => (label.uses ?? []).some((u) => uses.includes(u));

  const out: Record<string, L[]> = {};
  const split = new Set<string>();
  for (const name of extras) {
    const uses = usesOf(name);
    uses.forEach((u) => split.add(u));
    out[name] = labels.filter((l) => fits(l, uses));
  }
  const rest = picked.filter((u) => !split.has(u));
  // Labels from an older API carry no uses and stay in the first workspace.
  const first = rest.length ? labels.filter((l) => !l.uses?.length || fits(l, rest)) : labels;
  return { first, extras: out };
}
