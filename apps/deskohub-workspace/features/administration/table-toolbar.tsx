"use client";

import { type ReactNode, useState } from "react";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/utils";
import { formatCount } from "@/shared/utils/number";
import type { AdministrationHref } from "./administration-href";
import {
  type AdministrationListExportFailure,
  AdministrationTableExport,
  AdministrationTableExportAlert,
} from "./table-export";

export function AdministrationTableToolbar({
  actions,
  count,
  exportHref,
  filterLayout = "stacked",
  filters,
  label,
  search,
}: {
  readonly actions?: ReactNode;
  readonly count: ReactNode;
  /**
   * The list's CSV export path for its current filters: the export route
   * from `administrationHref` with the same params the list's sort links and
   * pagination carry, so the file matches what the operator sees. Adds the
   * export control to the actions and shows its failures below the controls.
   */
  readonly exportHref?: Promise<AdministrationHref>;
  /**
   * Where `filters` sit. `stacked` gives a wide filter grid its own row below
   * the count until the 2xl breakpoint. `inline` keeps a compact filter row,
   * such as a date range, on the count's row and wraps it below only when it
   * doesn't fit.
   */
  readonly filterLayout?: "inline" | "stacked";
  readonly filters?: ReactNode;
  /** The accessible name of the controls section, such as "Order table controls". */
  readonly label: string;
  readonly search?: ReactNode;
}) {
  const [exportFailure, setExportFailure] =
    useState<AdministrationListExportFailure | null>(null);
  const layout = filters ? filterLayout : "unfiltered";
  return (
    <section
      aria-label={label}
      className="mb-5 rounded-xl border border-navy-blue/10 bg-white p-4"
    >
      <div
        className={
          {
            inline: "flex flex-wrap items-center gap-4",
            stacked:
              "grid gap-4 2xl:grid-cols-[minmax(0,1fr)_auto] 2xl:items-center",
            unfiltered:
              "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4",
          }[layout]
        }
      >
        <div
          className={cn(
            "flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center",
            layout === "inline" &&
              "min-h-10 flex-auto justify-center sm:justify-start"
          )}
        >
          {count}
          {search && <div className="w-full sm:max-w-[32rem]">{search}</div>}
        </div>
        {(filters || actions || exportHref) && (
          <div
            className={
              layout === "inline"
                ? "ml-auto flex flex-wrap items-end justify-end gap-3"
                : "flex flex-col gap-3 2xl:flex-row 2xl:items-end 2xl:justify-end"
            }
          >
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
