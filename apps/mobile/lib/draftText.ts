import { useEffect, useRef, useState } from "react";

/** Local text that seeds from the server once per record, so typing isn't wiped by refetches. */
export function useDraftText(remote: string | undefined, key: string | undefined) {
  const [value, setValue] = useState(remote ?? "");
  const seededFor = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!key) return;
    if (seededFor.current === key) return;
    if (remote === undefined) return;
    seededFor.current = key;
    setValue(remote);
  }, [key, remote]);

  return [value, setValue] as const;
}
