import type { UnnormalizedLogicalExpression } from "@deskohub/cloudinary";
import { CloudinaryImage } from "@deskohub/cloudinary-image";
import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";
import { getCloudinaryImages } from "@/features/gallery/actions/get-cloudinary-images";
import type { CloudinaryTag } from "@/features/gallery/types/cloudinary-tag";
import { generateBlurDataUrl } from "@/features/gallery/utils/generate-blur-data-url";
import { cn } from "@/shared/utils";

const heroVariants = cva(null, {
  variants: {
    fullHeight: {
      true: "min-h-[calc(100dvh_-_var(--header-height)_-_90px)]",
      false: "min-h-96",
    },
    alignment: {
      center: "items-center justify-center text-center",
      left: "items-center justify-start text-left",
    },
  },
  defaultVariants: {
    fullHeight: false,
    alignment: "center",
  },
});

export interface HeroProps extends VariantProps<typeof heroVariants> {
  tags: UnnormalizedLogicalExpression<CloudinaryTag>;
  children: ReactNode;
  className?: string;
}

export async function Hero({
  tags,
  fullHeight,
  alignment,
  children,
  className,
}: HeroProps) {
  const [image] = await getCloudinaryImages({
    tags: [["hero", tags]],
    maxResults: 1,
  });

  // Generate blur data URL if we have an image
  const blurDataURL = image ? await generateBlurDataUrl(image) : undefined;

  return (
    <section
      className={cn(
        heroVariants({ fullHeight }),
        "relative overflow-hidden flex flex-col",
        className
      )}
    >
      {image && (
        <CloudinaryImage
          asset={image}
          variant="hero"
          blurDataURL={blurDataURL}
        />
      )}
      <div
        className={cn(
          "relative z-10 w-full h-full flex",
          heroVariants({ alignment })
        )}
      >
        <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-16">
          {children}
        </div>
      </div>
    </section>
  );
}
