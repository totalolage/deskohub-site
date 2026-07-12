"use client";

import { CloudinaryImage } from "@deskohub/cloudinary-image";
import { ImageOff } from "lucide-react";
import { useState } from "react";

type FounderProfileImageProps = {
  publicId: string;
  version: number;
};

export function FounderProfileImage({
  publicId,
  version,
}: FounderProfileImageProps) {
  const [hasImageError, setHasImageError] = useState(false);

  return (
    <>
      <div className="grid h-full place-items-center bg-[linear-gradient(145deg,#00024f,#1a1c71)]">
        <ImageOff aria-hidden="true" className="h-10 w-10 text-white/45" />
      </div>
      {!hasImageError && (
        <div className="contents" onErrorCapture={() => setHasImageError(true)}>
          <CloudinaryImage
            alt=""
            className="absolute inset-0 transition-transform duration-700 group-hover:scale-105"
            preload={false}
            publicId={publicId}
            size={{ width: "fill", height: "fill" }}
            sizes="(min-width: 1280px) 31vw, (min-width: 768px) 46vw, 100vw"
            variant="gallery"
            version={version}
          />
        </div>
      )}
    </>
  );
}
