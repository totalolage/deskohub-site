"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import type * as React from "react";
import { cn } from "@/shared/utils";

export interface SwitchProps
  extends React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  ref?: React.Ref<React.ComponentRef<typeof SwitchPrimitive.Root>>;
}

function Switch({ className, ref, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-navy-blue/12 bg-navy-blue/18 p-0.5 shadow-sm transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-burned-orange/10 disabled:cursor-not-allowed disabled:opacity-60 data-[state=checked]:border-burned-orange data-[state=checked]:bg-burned-orange",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block h-5 w-5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-5" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
