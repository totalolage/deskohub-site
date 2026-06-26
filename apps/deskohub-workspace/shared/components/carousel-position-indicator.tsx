"use client";

import { motion, type Transition } from "motion/react";
import { cn } from "@/shared/utils";

type CarouselPositionIndicatorVariant = "light" | "navy";

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

const variantClasses: Record<
  CarouselPositionIndicatorVariant,
  { button: string; active: string; inactive: string }
> = {
  light: {
    button:
      "border border-white/50 bg-white/45 shadow-sm focus-visible:outline-white",
    active: "bg-white",
    inactive: "hover:bg-white/75",
  },
  navy: {
    button: "bg-navy-blue/24 focus-visible:outline-burned-orange",
    active: "bg-burned-orange",
    inactive: "hover:bg-navy-blue/42",
  },
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

  const classes = variantClasses[variant];

  return (
    <div className={cn("flex gap-2", className)}>
      {Array.from({ length: count }, (_, index) => (
        <motion.button
          animate={{ width: index === activeIndex ? 40 : 10 }}
          aria-current={index === activeIndex ? "true" : undefined}
          aria-label={getLabel(index)}
          className={cn(
            "h-2.5 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4",
            classes.button,
            index === activeIndex ? classes.active : classes.inactive
          )}
          key={getKey?.(index) ?? index}
          onClick={() => onSelect(index)}
          transition={transition}
          type="button"
        />
      ))}
    </div>
  );
}
