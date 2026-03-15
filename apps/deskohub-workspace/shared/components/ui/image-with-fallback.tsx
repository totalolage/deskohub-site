"use client";

import Image, { type ImageProps } from "next/image";
import { useEffect, useState } from "react";

type ImageWithFallbackProps = Omit<ImageProps, "onError"> & {
  fallbackSrc?: ImageProps["src"];
};

export function ImageWithFallback({
  src,
  fallbackSrc,
  alt,
  ...props
}: ImageWithFallbackProps) {
  const [activeSrc, setActiveSrc] = useState<ImageProps["src"]>(src);

  useEffect(() => {
    setActiveSrc(src);
  }, [src]);

  return (
    <Image
      {...props}
      src={activeSrc}
      alt={alt}
      onError={() => {
        if (fallbackSrc && activeSrc !== fallbackSrc) {
          setActiveSrc(fallbackSrc);
        }
      }}
    />
  );
}
