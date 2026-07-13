"use client";

import { CloudinaryImage } from "@deskohub/cloudinary-image";
import { ImageOff } from "lucide-react";
import { useState } from "react";

type FounderProfileImageProps = {
  publicId: string;
};

export function FounderProfileImage({ publicId }: FounderProfileImageProps) {
  const [hasImageError, setHasImageError] = useState(false);

  return (
    <>
      <div className="grid h-full place-items-center bg-[linear-gradient(145deg,#00024f,#1a1c71)]">
        <ImageOff aria-hidden="true" className="h-10 w-10 text-white/45" />
      </div>
      {!hasImageError && (
        <CloudinaryImage
          alt=""
          aspectRatio={1}
          className="absolute inset-0"
          gravity="auto:thirds_0"
          onError={() => setHasImageError(true)}
          preload={false}
          source={publicId}
          size={{ width: "fill", height: "fill" }}
          sizes="(min-width: 640px) 160px, 112px"
          variant="gallery"
        />
      )}
    </>
  );
}
