import type { ReactNode } from "react";
import { Badge } from "@/shared/components/ui/badge";

export function AdministrationTableToolbar({
  count,
  itemLabel,
  primaryControls,
  secondaryControls,
}: {
  readonly count: number;
  readonly itemLabel: string;
  readonly primaryControls: ReactNode;
  readonly secondaryControls?: ReactNode;
}) {
  return (
    <div className="mb-5 grid gap-5 rounded-xl border border-navy-blue/10 bg-white p-4 2xl:grid-cols-[minmax(22rem,1fr)_auto] 2xl:items-end">
      <div className="grid gap-3 sm:grid-cols-[auto_minmax(18rem,1fr)] sm:items-center">
        <Badge
          aria-label={`${count} ${itemLabel}${count === 1 ? "" : "s"}`}
          className="w-fit"
          variant="subtle"
        >
          {count}
        </Badge>
        <div className="w-full sm:max-w-[32rem] sm:justify-self-end">
          {primaryControls}
        </div>
      </div>
      {secondaryControls}
    </div>
  );
}
