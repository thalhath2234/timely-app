import { Fragment } from "react";

// React text nodes keep tool/model content inert. Only safe links are rendered;
// no model-authored HTML or raw innerHTML enters the conversation.
function inline(text: string) {
  return text
    .split(
      /(\[[^\]]+\]\(https?:\/\/[^\s)]+\)|\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s<>)]+)/g,
    )
    .map((part, i) => {
      const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (link)
        return (
          <a
            key={i}
            href={link[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="break-words text-primary underline underline-offset-4"
          >
            {link[1]}
          </a>
        );
      if (/^https?:\/\//.test(part))
        return (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-primary underline underline-offset-4"
          >
            {part.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          </a>
        );
      if (part.startsWith("**") && part.endsWith("**"))
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("`") && part.endsWith("`"))
        return (
          <code
            key={i}
            className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
          >
            {part.slice(1, -1)}
          </code>
        );
      return <Fragment key={i}>{part}</Fragment>;
    });
}
export default function ChatText({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const lines = text.split("\n");
  return (
    <div
      className={`space-y-1.5 whitespace-pre-wrap break-words text-sm leading-6 ${className}`}
    >
      {lines.map((line, i) => {
        const heading = line.match(/^#{1,4}\s+(.+)/);
        if (heading)
          return (
            <p key={i} className="pt-1.5 font-semibold text-foreground">
              {inline(heading[1])}
            </p>
          );
        const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)/);
        if (numbered)
          return (
            <div key={i} className="flex gap-2.5">
              <span
                aria-hidden
                className="w-5 shrink-0 text-right tabular-nums text-muted-foreground"
              >
                {numbered[1]}.
              </span>
              <span className="min-w-0 flex-1">{inline(numbered[2])}</span>
            </div>
          );
        if (/^\s*[-*•]\s+/.test(line))
          return (
            <div key={i} className="flex gap-2.5">
              <span
                aria-hidden
                className="w-5 shrink-0 text-center text-muted-foreground"
              >
                •
              </span>
              <span className="min-w-0 flex-1">
                {inline(line.replace(/^\s*[-*•]\s+/, ""))}
              </span>
            </div>
          );
        if (!line.trim()) return <div key={i} aria-hidden className="h-1.5" />;
        return <p key={i}>{inline(line)}</p>;
      })}
    </div>
  );
}
