import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/shared/utils";

export type StatusTone = "attention" | "neutral" | "positive" | "progress";

export function StatusBadge({
  children,
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  readonly children: ReactNode;
  readonly tone: StatusTone;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
        {
          attention:
            "border-burned-orange/25 bg-burned-orange/10 text-burned-orange-ink",
          neutral: "border-navy-blue/12 bg-navy-blue/5 text-navy-blue/65",
          positive:
            "border-aquamarine-green/35 bg-aquamarine-green/12 text-aquamarine-ink",
          progress:
            "border-sunset-yellow/35 bg-sunset-yellow/15 text-navy-blue",
        }[tone],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
