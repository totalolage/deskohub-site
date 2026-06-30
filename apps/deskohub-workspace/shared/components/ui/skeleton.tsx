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
      className={cn("animate-pulse rounded-md bg-navy-blue/8", className)}
      {...props}
    />
  );
}

export { Skeleton };
