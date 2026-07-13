"use client";

import { useAtomValue } from "@effect/atom-react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/shared/utils";
import {
  censoredFounderNameLabel,
  scrambledFounderNameAtom,
} from "./censored-founder-name-animation";
import { useCensoredFounderNameAnimation } from "./use-censored-founder-name-animation";

type CensoredFounderNameProps = {
  className?: string;
};

export function CensoredFounderName({ className }: CensoredFounderNameProps) {
  const shouldReduceMotion = useReducedMotion();
  const scrambledLabel = useAtomValue(scrambledFounderNameAtom);

  useCensoredFounderNameAnimation(!shouldReduceMotion);

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block whitespace-nowrap font-mono text-lg font-medium tracking-wide text-white drop-shadow-[0_2px_4px_rgba(0,2,79,0.9)]",
        className
      )}
    >
      {shouldReduceMotion ? censoredFounderNameLabel : scrambledLabel}
    </span>
  );
}
