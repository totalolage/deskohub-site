"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { motion, type Transition } from "motion/react";
import { UnstyledButton } from "@/shared/components/ui/unstyled-button";
import { cn } from "@/shared/utils";

const indicatorDotVariants = cva("h-2.5 rounded-full", {
  variants: {
    active: {
      true: "",
      false: "",
    },
    variant: {
      light: "border border-white/50 bg-white/45 shadow-sm",
      navy: "bg-navy-blue/24",
    },
  },
  compoundVariants: [
    { active: true, class: "bg-white", variant: "light" },
    { active: false, class: "hover:bg-white/75", variant: "light" },
    { active: true, class: "bg-burned-orange", variant: "navy" },
    { active: false, class: "hover:bg-navy-blue/42", variant: "navy" },
  ],
  defaultVariants: {
    active: false,
    variant: "light",
  },
});

type CarouselPositionIndicatorVariant = NonNullable<
  VariantProps<typeof indicatorDotVariants>["variant"]
>;

type CarouselPositionIndicatorProps = {
  count: number;
  activeIndex: number;
  getLabel: (index: number) => string;
  onSelect: (index: number) => void;
  className?: string;
  getKey?: (index: number) => string | number;
  transition?: Transition;
  variant?: CarouselPositionIndicatorVariant;
};

export function CarouselPositionIndicator({
  count,
  activeIndex,
  className,
  getKey,
  getLabel,
  onSelect,
  transition,
  variant = "light",
}: CarouselPositionIndicatorProps) {
  if (count <= 1) return null;

  return (
    <div className={cn("flex flex-wrap justify-center", className)}>
      {Array.from({ length: count }, (_, index) => (
        <UnstyledButton
          aria-current={index === activeIndex ? "true" : undefined}
          aria-label={getLabel(index)}
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-full",
            variant === "light" && "focus-visible:outline-white"
          )}
          key={getKey?.(index) ?? index}
          onClick={() => onSelect(index)}
        >
          <motion.span
            animate={{ width: index === activeIndex ? 24 : 10 }}
            className={indicatorDotVariants({
              active: index === activeIndex,
              variant,
            })}
            transition={transition}
          />
        </UnstyledButton>
      ))}
    </div>
  );
}
