"use client";

import type { ReactNode } from "react";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/utils";
import { formatCount } from "@/shared/utils/number";

export function AdministrationTableToolbar({
  actions,
  count,
  filters,
  label,
  search,
}: {
  readonly actions?: ReactNode;
  readonly count: ReactNode;
  readonly filters?: ReactNode;
  /** The accessible name of the controls section, such as "Order table controls". */
  readonly label: string;
  readonly search?: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        "mb-5 grid gap-4 rounded-xl border border-navy-blue/10 bg-white p-4",
        filters
          ? "2xl:grid-cols-[minmax(0,1fr)_auto] 2xl:items-center"
          : "grid-cols-[minmax(0,1fr)_auto] items-center"
      )}
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
        {count}
        {search && <div className="w-full sm:max-w-[32rem]">{search}</div>}
      </div>
      {(filters || actions) && (
        <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-end 2xl:justify-end">
          {filters}
          {actions && <div className="self-end">{actions}</div>}
        </div>
      )}
    </section>
  );
}

export function AdministrationTableCount({
  count,
  label,
}: {
  readonly count: number;
  /** The count with its noun, such as "3 orders". */
  readonly label: string;
}) {
  const locale = useRouteLocale();
  return (
    <Badge aria-label={label} className="w-fit" variant="subtle">
      {formatCount(count, locale)}
    </Badge>
  );
}
