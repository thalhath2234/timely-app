/**
 * A script that runs while the HTML is parsed. On the client it is rendered as
 * inert text, which keeps React from warning about script tags it would never
 * execute; see Next's "Preventing flash before hydration" guide.
 */
export default function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
