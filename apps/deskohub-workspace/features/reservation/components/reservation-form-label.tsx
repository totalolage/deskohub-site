import type { ComponentProps } from "react";
import { FormLabel } from "@/shared/components/ui/form";
import { cn } from "@/shared/utils";

export function ReservationFormLabel({
  className,
  ...props
}: ComponentProps<typeof FormLabel>) {
  return (
    <FormLabel
      className={cn(
        "text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72",
        className
      )}
      {...props}
    />
  );
}
