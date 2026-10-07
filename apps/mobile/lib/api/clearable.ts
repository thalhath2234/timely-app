/**
 * Update bodies on the server bind every field as a pointer: a missing or JSON
 * `null` value leaves the column alone, and an empty string (0 for a minutes
 * field) clears it. Screens say "clear" with `null`; `clearNulls` turns that
 * into the wire value at the API boundary so a cleared field is not silently
 * kept. Keys where the server reads `null` itself (`recurrence`) are not
 * listed and pass through unchanged.
 */
export type Clearable<T, K extends keyof T> = Omit<T, K> & {
  [P in K]?: T[P] | null;
};

export function clearNulls<T extends object>(
  data: Clearable<T, keyof T>,
  keys: readonly string[],
  zeroKeys: readonly string[] = [],
): T {
  const out: Record<string, unknown> = { ...data };
  for (const key of keys) {
    if (out[key] === null) out[key] = zeroKeys.includes(key) ? 0 : "";
  }
  return out as T;
}
