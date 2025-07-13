import { cva, type VariantProps } from "class-variance-authority";
import Image, { type StaticImageData } from "next/image";
import type { ReactNode } from "react";
import { m } from "@/i18n";
import { cn } from "@/shared/utils";

const heroVariants = cva(null, {
  variants: {
    fullHeight: {
      true: "min-h-[calc(100dvh_-_var(--header-height))]",
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

interface HeroProps extends VariantProps<typeof heroVariants> {
  imageSrc: string | StaticImageData;
  children: ReactNode;
  className?: string;
}

export function Hero({
  imageSrc,
  fullHeight,
  alignment,
  children,
  className,
}: HeroProps) {
  return (
    <section
      className={cn(
        heroVariants({ fullHeight }),
        "relative overflow-hidden flex flex-col",
        className
      )}
    >
      <Image
        src={imageSrc}
        alt={m["altText.heroImage"]()}
        fill
        className="object-cover brightness-50 absolute inset-0 z-0"
        priority
      />
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
