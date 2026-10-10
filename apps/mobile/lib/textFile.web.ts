/** A small text file the app keeps between runs. */
export type TextFile = {
  read(): string | null;
  write(text: string): void;
};

/** The web build's stand-in for the document directory: localStorage in the
 * browser, nothing while Expo renders the page on the server. expo-file-system
 * has no web implementation, and touching it there stops the app loading. */
export function documentTextFile(name: string): TextFile {
  const key = `timely.${name}`;
  const storage = () =>
    typeof localStorage === "undefined" ? undefined : localStorage;
  return {
    read: () => storage()?.getItem(key) ?? null,
    write: (text) => storage()?.setItem(key, text),
  };
}
