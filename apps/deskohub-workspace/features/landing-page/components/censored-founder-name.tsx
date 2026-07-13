"use client";

import { cn } from "@/shared/utils";
import { useCensoredFounderName } from "./use-censored-founder-name";

type CensoredFounderNameProps = {
  className?: string;
};

export function CensoredFounderName({ className }: CensoredFounderNameProps) {
  const label = useCensoredFounderName();

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block whitespace-nowrap font-mono text-lg font-medium tracking-wide text-white drop-shadow-[0_2px_4px_rgba(0,2,79,0.9)]",
        className
      )}
    >
      {label}
    </span>
  );
}
