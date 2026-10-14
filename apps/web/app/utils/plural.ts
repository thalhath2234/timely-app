/** The noun for `count`: "task" for 1, otherwise "tasks" (or `many`). */
export function pluralWord(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}

/** A count with its noun: "1 task", "0 tasks", "3 tasks". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${pluralWord(count, one, many)}`;
}
