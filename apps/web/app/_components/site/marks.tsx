/** Small brand marks for the public site. All follow `currentColor`. */

type MarkProps = { className?: string };

export function GitHubMark({ className }: MarkProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function WindowsMark({ className }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M3 5.3 10.4 4.3v7.1H3V5.3Zm0 13.4 7.4 1v-7H3v6Zm8.3 1.1L21 21.1v-8.4h-9.7v7.1Zm0-15.6v7.2H21V2.9l-9.7 1.3Z" />
    </svg>
  );
}

export function UbuntuMark({ className }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth="2.2">
      <circle cx="12" cy="12" r="6.2" />
      <circle cx="12" cy="3.6" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="4.7" cy="16.2" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="19.3" cy="16.2" r="2.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ArchMark({ className }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M12 2c-.9 2.2-1.4 3.6-2.4 5.7.6.6 1.4 1.4 2.6 2.2-1.3-.5-2.2-1.1-2.9-1.7C7.9 11 5.9 14.8 2 21.8c3.1-1.8 5.4-2.9 7.6-3.3-.1-.4-.2-.9-.1-1.4v-.1c.1-1.9 1.1-3.4 2.3-3.3 1.2.1 2.1 1.8 2 3.7 0 .4-.1.7-.1 1 2.2.4 4.5 1.5 7.5 3.3l-1.8-3.3c-.9-.7-1.8-1.6-3.6-2.5 1.2.3 2.1.7 2.8 1.1C15.1 10.3 14.3 7.9 12 2Z" />
    </svg>
  );
}

export function AndroidMark({ className }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M17.6 9.5 19.4 6.4a.4.4 0 0 0-.7-.4l-1.8 3.1A11 11 0 0 0 12 8a11 11 0 0 0-4.9 1.1L5.3 6a.4.4 0 0 0-.7.4l1.8 3.1A9.6 9.6 0 0 0 1.5 17h21a9.6 9.6 0 0 0-4.9-7.5ZM7 14.3a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2Zm10 0a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2Z" />
    </svg>
  );
}
