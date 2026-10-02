"use client";

/**
 * A script that runs while the HTML is parsed. It has to be a Client Component:
 * on the server it renders as JavaScript, and on the client (hydration, or
 * arriving by in-app navigation) as inert text, which keeps React from warning
 * about a script tag it would never execute. See Next's "Preventing flash
 * before hydration" guide.
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
