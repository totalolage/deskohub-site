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
  },
  defaultVariants: {
    fullHeight: false,
  },
});

interface HeroProps extends VariantProps<typeof heroVariants> {
  imageSrc: string | StaticImageData;
  children: ReactNode;
  className?: string;
}

export function Hero({ imageSrc, fullHeight, children, className }: HeroProps) {
  return (
    <section
      className={cn(
        heroVariants({ fullHeight }),
        "relative overflow-hidden flex items-center justify-center flex-col",
        className,
      )}
    >
      <Image
        src={imageSrc}
        alt={m["altText.heroImage"]()}
        fill
        className="object-cover brightness-50 absolute inset-0 z-0"
        priority
      />
      {children}
    </section>
  );
}
