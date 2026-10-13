/**
 * Search finds a saved task view by its name ("show my deadline" opens
 * "My Deadlines", "board" opens "Board"). Both apps read the same rule, and
 * it needs no Smart suggestions key: Jev only adds the looser readings
 * ("what needs attention").
 */

/** The fields a view match reads; a full `TaskViewConfig` satisfies it. */
export interface NamedView {
  id: string;
  name: string;
}

// Words that ask to see something rather than name it.
const FILLER = new Set([
  "a",
  "all",
  "an",
  "are",
  "at",
  "display",
  "do",
  "find",
  "for",
  "get",
  "go",
  "i",
  "is",
  "let",
  "look",
  "me",
  "my",
  "of",
  "open",
  "page",
  "please",
  "see",
  "show",
  "switch",
  "tab",
  "the",
  "to",
  "view",
  "want",
  "what",
  "whats",
  "which",
]);

// Other words people use for the same thing.
const ALIASES: Record<string, string> = {
  due: "deadline",
  kanban: "board",
  todo: "task",
};

// A word this long can be cut short while typing ("dead" for "deadlines").
const MIN_PREFIX = 4;

function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss"))
    return word.slice(0, -1);
  return word;
}

function words(text: string): string[] {
  const out: string[] = [];
  for (const raw of text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}]+/u)) {
    const word = stem(raw);
    if (!raw || FILLER.has(raw) || FILLER.has(word)) continue;
    out.push(ALIASES[word] ?? word);
  }
  return out;
}

function fits(typed: string, word: string, last: boolean): boolean {
  if (typed === word) return true;
  // Only the word still being typed may be cut short.
  return last && typed.length >= MIN_PREFIX && word.startsWith(typed);
}

/**
 * The saved view a search names, or undefined. Every word of the search
 * (past the "show my" kind) must be a word of the view's name and every word
 * of the name must be searched, so "task" alone does not open "Task List" and
 * "deadline report" opens nothing. The last word may be cut short while typing.
 */
export function matchViewByName<V extends NamedView>(
  query: string,
  views: readonly V[],
): V | undefined {
  const typed = words(query);
  if (typed.length === 0) return undefined;
  let best: { view: V; exact: boolean } | undefined;
  for (const view of views) {
    const name = words(view.name);
    if (name.length === 0 || typed.length !== name.length) continue;
    const left = [...name];
    let exact = true;
    const ok = typed.every((word, index) => {
      const last = index === typed.length - 1;
      const at = left.findIndex((part) => fits(word, part, last));
      if (at < 0) return false;
      if (left[at] !== word) exact = false;
      left.splice(at, 1);
      return true;
    });
    if (!ok) continue;
    if (exact) return view;
    best ??= { view, exact };
  }
  return best?.view;
}
