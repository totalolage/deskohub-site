import type { ReactNode } from "react";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/utils";
import { ReservationFormCard } from "./reservation-form-card";

type ReservationFormFallbackProps = {
  readonly children: ReactNode;
  readonly label: string;
};

export function ReservationFormFallback({
  children,
  label,
}: ReservationFormFallbackProps) {
  return (
    <ReservationFormCard ariaLabel={label} busy>
      <div aria-hidden="true" className="space-y-7">
        {children}
      </div>
    </ReservationFormCard>
  );
}

export function ReservationCustomerFieldsFallback() {
  return (
    <>
      <div className="grid gap-5 md:grid-cols-2">
        <ReservationSkeletonField />
        <ReservationSkeletonField />
      </div>
      <ReservationSkeletonField />
      <ReservationSkeletonBlock className="h-34 w-full rounded-[1.1rem]" />
    </>
  );
}

export function ReservationSubmitFallback() {
  return (
    <ReservationSkeletonBlock className="h-13 w-full rounded-full bg-burned-orange/18" />
  );
}

export function ReservationSkeletonField() {
  return (
    <div className="space-y-2">
      <ReservationSkeletonBlock className="h-4 w-28" />
      <ReservationSkeletonBlock className="h-13 w-full rounded-[1.1rem]" />
    </div>
  );
}

export function ReservationSkeletonBlock({
  className,
}: {
  readonly className: string;
}) {
  return (
    <Skeleton
      className={cn(
        "rounded-full bg-navy-blue/8 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]",
        className
      )}
    />
  );
}
