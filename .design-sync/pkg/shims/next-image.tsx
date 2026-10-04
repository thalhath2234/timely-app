// Stand-in for next/image: a plain <img> (Next-only props dropped).
import type { ImgHTMLAttributes } from "react";

type ImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string | { src: string };
  priority?: boolean;
  quality?: number;
  fill?: boolean;
  unoptimized?: boolean;
  placeholder?: string;
  blurDataURL?: string;
};

export default function Image({ src, priority: _p, quality: _q, fill, unoptimized: _u, placeholder: _ph, blurDataURL: _b, style, ...rest }: ImageProps) {
  const url = typeof src === "string" ? src : src.src;
  const fillStyle = fill ? { position: "absolute" as const, inset: 0, width: "100%", height: "100%" } : undefined;
  return <img src={url} style={{ ...fillStyle, ...style }} {...rest} />;
}
