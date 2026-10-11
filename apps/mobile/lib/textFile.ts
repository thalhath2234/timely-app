import { File, Paths } from "expo-file-system";

/** A small text file the app keeps between runs. */
export type TextFile = {
  read(): string | null;
  write(text: string): void;
};

/** A text file in the app's document directory. The file is opened on first
 * use, not when the module loads, so importing a store never touches the
 * file system. The web build uses textFile.web.ts instead. */
export function documentTextFile(name: string): TextFile {
  let file: File | undefined;
  const open = () => (file ??= new File(Paths.document, name));
  return {
    read: () => {
      const f = open();
      return f.exists ? f.textSync() : null;
    },
    write: (text) => open().write(text),
  };
}
