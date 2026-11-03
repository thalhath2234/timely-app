import { Children, type ReactNode } from "react";

/**
 * True when children are only strings and numbers, such as `{name}{" · "}{id}`.
 * React Native draws text only inside a `<Text>`: the same strings handed
 * straight to a `<View>` show nothing on a phone (Expo web still prints
 * them), so a row that takes children wraps these in a `<Text>` itself.
 */
export function isPlainText(children: ReactNode): boolean {
  const parts = Children.toArray(children);
  return (
    parts.length > 0 &&
    parts.every((part) => typeof part === "string" || typeof part === "number")
  );
}
