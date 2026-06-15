"use client";

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import type * as React from "react";
import { cn } from "@/shared/utils";

export interface CheckboxProps
  extends React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> {
  ref?: React.Ref<React.ComponentRef<typeof CheckboxPrimitive.Root>>;
}

function Checkbox({ className, ref, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        "peer grid h-5 w-5 shrink-0 place-items-center rounded-md border border-navy-blue/20 bg-white text-white shadow-sm transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-burned-orange/10 disabled:cursor-not-allowed disabled:opacity-60 data-[state=checked]:border-burned-orange data-[state=checked]:bg-burned-orange",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="h-4 w-4" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
