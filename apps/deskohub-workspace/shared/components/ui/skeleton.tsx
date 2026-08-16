import type * as React from "react";
import { cn } from "@/shared/utils";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  ref?: React.Ref<HTMLDivElement>;
}

function Skeleton({ className, ref, ...props }: SkeletonProps) {
  return (
    <div
      ref={ref}
      data-slot="skeleton"
      className={cn(
        "relative overflow-hidden rounded-md bg-navy-blue/8 after:pointer-events-none after:absolute after:inset-y-0 after:left-0 after:w-1/2 after:animate-skeleton-glimmer after:bg-linear-to-r after:from-transparent after:via-white/55 after:to-transparent after:content-[''] motion-reduce:after:hidden",
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
