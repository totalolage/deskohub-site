"use client";

import * as TogglePrimitive from "@radix-ui/react-toggle";
import type * as React from "react";
import { cn } from "@/shared/utils";
import { buttonVariants } from "./button";

/**
 * An on/off control, such as Bold in a text editor toolbar. It looks like a
 * ghost icon Button and tints while pressed. The tint follows `aria-pressed`
 * because a wrapping trigger, such as a tooltip's, replaces Radix's
 * `data-state`.
 */
function Toggle({
  className,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root>) {
  return (
    <TogglePrimitive.Root
      className={cn(
        buttonVariants({ size: "icon-sm", tone: "muted", variant: "ghost" }),
        "aria-pressed:bg-navy-blue/12 aria-pressed:text-navy-blue",
        className
      )}
      {...props}
    />
  );
}

export { Toggle };
