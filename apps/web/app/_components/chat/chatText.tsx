import { Fragment } from "react";

// React text nodes keep tool/model content inert. Only safe links are rendered;
// no model-authored HTML or raw innerHTML enters the conversation.
function inline(text: string) {
  return text
    .split(/(\[[^\]]+\]\(https?:\/\/[^\s)]+\)|\*\*[^*]+\*\*|`[^`]+`)/g)
    .map((part, i) => {
      const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (link)
        return (
          <a
            key={i}
            href={link[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-4 break-words"
          >
            {link[1]}
          </a>
        );
      if (part.startsWith("**") && part.endsWith("**"))
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("`") && part.endsWith("`"))
        return (
          <code key={i} className="rounded bg-muted px-1 text-[0.9em]">
            {part.slice(1, -1)}
          </code>
        );
      return <Fragment key={i}>{part}</Fragment>;
    });
}
export default function ChatText({ text }: { text: string }) {
  return (
    <div className="space-y-2 whitespace-pre-wrap break-words text-sm leading-7">
      {text.split("\n").map((line, i) => {
        const heading = line.match(/^#{1,4}\s+(.+)/);
        if (heading)
          return (
            <p key={i} className="pt-2 font-semibold text-foreground">
              {inline(heading[1])}
            </p>
          );
        if (/^[-*] /.test(line))
          return (
            <div key={i} className="flex gap-3">
              <span aria-hidden className="text-muted-foreground">
                •
              </span>
              <span>{inline(line.slice(2))}</span>
            </div>
          );
        return <p key={i}>{inline(line) || "\u00a0"}</p>;
      })}
    </div>
  );
}
