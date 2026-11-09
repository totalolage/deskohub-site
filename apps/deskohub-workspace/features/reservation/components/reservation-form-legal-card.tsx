import type { ReactNode } from "react";

type ReservationFormLegalCardProps = {
  readonly children: ReactNode;
  readonly indicator: ReactNode;
};

export function ReservationFormLegalCard({
  children,
  indicator,
}: ReservationFormLegalCardProps) {
  return (
    <div className="flex items-start gap-3 rounded-[1.35rem] border border-navy-blue/10 bg-navy-blue/2.5 p-4">
      <span className="mt-1 shrink-0">{indicator}</span>
      <span className="text-sm leading-6 text-navy-blue/66">{children}</span>
    </div>
  );
}
