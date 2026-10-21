"use client";

import { type ReactNode, useState } from "react";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/utils";
import { formatCount } from "@/shared/utils/number";
import {
  type AdministrationListExportFailure,
  AdministrationTableExport,
  AdministrationTableExportAlert,
} from "./table-export";

export function AdministrationTableToolbar({
  actions,
  count,
  exportHref,
  filters,
  label,
  search,
}: {
  readonly actions?: ReactNode;
  readonly count: ReactNode;
  /**
   * The list's CSV export path for its current filters, such as one from
   * `getAdministrationListExportHref`. Adds the export control to the actions
   * and shows its failures below the controls.
   */
  readonly exportHref?: Promise<string>;
  readonly filters?: ReactNode;
  /** The accessible name of the controls section, such as "Order table controls". */
  readonly label: string;
  readonly search?: ReactNode;
}) {
  const [exportFailure, setExportFailure] =
    useState<AdministrationListExportFailure | null>(null);
  return (
    <section
      aria-label={label}
      className="mb-5 rounded-xl border border-navy-blue/10 bg-white p-4"
    >
      <div
        className={cn(
          "grid gap-4",
          filters
            ? "2xl:grid-cols-[minmax(0,1fr)_auto] 2xl:items-center"
            : "grid-cols-[minmax(0,1fr)_auto] items-center"
        )}
      >
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
          {count}
          {search && <div className="w-full sm:max-w-[32rem]">{search}</div>}
        </div>
        {(filters || actions || exportHref) && (
          <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-end 2xl:justify-end">
            {filters}
            {(actions || exportHref) && (
              <div className="flex items-start gap-2 self-end">
                {actions}
                {exportHref && (
                  <AdministrationTableExport
                    href={exportHref}
                    onFailureChange={setExportFailure}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {exportHref && <AdministrationTableExportAlert failure={exportFailure} />}
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
