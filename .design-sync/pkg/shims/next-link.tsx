// Stand-in for next/link: a plain anchor (Next-only props dropped).
import { forwardRef, type AnchorHTMLAttributes } from "react";

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string | { pathname?: string };
  prefetch?: boolean | null;
  replace?: boolean;
  scroll?: boolean;
  shallow?: boolean;
};

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, prefetch: _p, replace: _r, scroll: _s, shallow: _sh, ...rest },
  ref,
) {
  const url = typeof href === "string" ? href : href.pathname ?? "#";
  return <a ref={ref} href={url} {...rest} />;
});

export default Link;
