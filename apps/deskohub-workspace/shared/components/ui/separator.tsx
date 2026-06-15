"use client";

import * as SeparatorPrimitive from "@radix-ui/react-separator";
import type * as React from "react";
import { cn } from "@/shared/utils";

export interface SeparatorProps
  extends React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root> {
  ref?: React.Ref<React.ComponentRef<typeof SeparatorPrimitive.Root>>;
}

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ref,
  ...props
}: SeparatorProps) {
  return (
    <SeparatorPrimitive.Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-navy-blue/10",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className
      )}
      {...props}
    />
  );
}

Separator.displayName = SeparatorPrimitive.Root.displayName;

export { Separator };
