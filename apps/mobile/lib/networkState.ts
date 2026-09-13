let offline = false;
const listeners = new Set<(offline: boolean) => void>();

export function setOffline(value: boolean) {
  if (offline === value) return;
  offline = value;
  for (const listener of listeners) listener(value);
}

export function isOffline() { return offline; }

export function subscribeOffline(listener: (offline: boolean) => void) {
  listeners.add(listener);
  listener(offline);
  return () => { listeners.delete(listener); };
}
