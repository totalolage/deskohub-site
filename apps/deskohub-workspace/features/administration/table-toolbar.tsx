import type { ReactNode } from "react";
import { Badge } from "@/shared/components/ui/badge";

export function AdministrationTableToolbar({
  actions,
  count,
  filters,
  itemLabel,
  search,
}: {
  readonly actions?: ReactNode;
  readonly count: number | ReactNode;
  readonly filters?: ReactNode;
  readonly itemLabel: string;
  readonly search?: ReactNode;
}) {
  return (
    <section
      aria-label={`${itemLabel} table controls`}
      className="mb-5 grid gap-4 rounded-xl border border-navy-blue/10 bg-white p-4 2xl:grid-cols-[minmax(0,1fr)_auto] 2xl:items-center"
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
        {typeof count === "number" ? (
          <AdministrationTableCount count={count} itemLabel={itemLabel} />
        ) : (
          count
        )}
        {search && <div className="w-full sm:max-w-[32rem]">{search}</div>}
      </div>
      {(filters || actions) && (
        <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-end 2xl:justify-end">
          {filters}
          {actions}
        </div>
      )}
    </section>
  );
}

export function AdministrationTableCount({
  count,
  itemLabel,
}: {
  readonly count: number;
  readonly itemLabel: string;
}) {
  return (
    <Badge
      aria-label={`${count} ${itemLabel}${count === 1 ? "" : "s"}`}
      className="w-fit"
      variant="subtle"
    >
      {count}
    </Badge>
  );
}
