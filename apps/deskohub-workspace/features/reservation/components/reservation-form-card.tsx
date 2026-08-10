import type { ReactNode } from "react";
import { Card, CardContent } from "@/shared/components/ui/card";

type ReservationFormCardProps = {
  readonly ariaLabel?: string;
  readonly busy?: boolean;
  readonly children: ReactNode;
};

export function ReservationFormCard({
  ariaLabel,
  busy,
  children,
}: ReservationFormCardProps) {
  return (
    <Card
      aria-busy={busy}
      aria-label={ariaLabel}
      className="relative overflow-hidden rounded-4xl border-white/55 bg-white/94 text-navy-blue shadow-[0_44px_140px_-54px_rgba(0,2,79,0.62)] backdrop-blur-sm"
      role={ariaLabel ? "region" : undefined}
    >
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-linear-to-r from-transparent via-sunset-yellow/80 to-transparent" />
      <CardContent className="pt-6">{children}</CardContent>
    </Card>
  );
}
