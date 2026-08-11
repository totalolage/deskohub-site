import type { ReactNode } from "react";
import { Card, CardContent } from "@/shared/components/ui/card";
import { cn } from "@/shared/utils";

type ReservationFormCardProps = {
  readonly ariaLabel?: string;
  readonly busy?: boolean;
  readonly children: ReactNode;
  readonly sale?: ReactNode;
};

export function ReservationFormCard({
  ariaLabel,
  busy,
  children,
  sale,
}: ReservationFormCardProps) {
  return (
    <Card
      aria-busy={busy}
      aria-label={ariaLabel}
      className={cn(
        "relative overflow-hidden rounded-4xl border-white/55 bg-white/94 text-navy-blue shadow-[0_44px_140px_-54px_rgba(0,2,79,0.62)] backdrop-blur-sm",
        sale &&
          "glow-border glow-border-purple-300 glow-border-count-1 glow-border-duration-5000 border-purple-300/60 ring-4 ring-purple-500/10"
      )}
      data-reservation-sale={sale ? "active" : undefined}
      role={ariaLabel ? "region" : undefined}
    >
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-linear-to-r from-transparent via-sunset-yellow/80 to-transparent" />
      {sale}
      <CardContent className="pt-6">{children}</CardContent>
    </Card>
  );
}
