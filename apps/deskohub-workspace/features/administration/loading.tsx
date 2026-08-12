import type { ReactNode } from "react";
import { AdministrationPage } from "@/features/administration/components";
import { AdministrationTableFrame } from "@/features/administration/table-frame";
import { Skeleton } from "@/shared/components/ui/skeleton";

const skeletonKeys = (group: string, count: number) =>
  Array.from({ length: count }, (_, position) => `${group}-${position + 1}`);

function LoadingRegion({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) {
  return (
    <output aria-busy="true" aria-label={label}>
      <span className="sr-only">{label}</span>
      <div aria-hidden>{children}</div>
    </output>
  );
}

export function AdministrationBreadcrumbLoading() {
  return (
    <LoadingRegion label="Loading breadcrumb">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-16" />
        <span className="text-navy-blue/25">/</span>
        <Skeleton className="h-4 w-28" />
      </div>
    </LoadingRegion>
  );
}

export function AdministrationCountLoading({
  label,
}: {
  readonly label: string;
}) {
  return (
    <LoadingRegion label={`Loading ${label} count`}>
      <Skeleton className="h-5 w-9 rounded-full" />
    </LoadingRegion>
  );
}

export function AdministrationFiltersLoading({
  fields = 3,
}: {
  readonly fields?: number;
}) {
  return (
    <LoadingRegion label="Loading table filters">
      <div className="flex flex-wrap items-end gap-3">
        {skeletonKeys("filter-field", fields).map((key) => (
          <div className="w-36" key={key}>
            <Skeleton className="mb-2 h-3 w-20" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
        <Skeleton className="h-10 w-28" />
      </div>
    </LoadingRegion>
  );
}

export function AdministrationMetricsLoading() {
  return (
    <LoadingRegion label="Loading reservation activity">
      <div className="grid gap-3 lg:grid-cols-3">
        {["today", "upcoming", "recent"].map((key) => (
          <div
            className="rounded-xl border border-navy-blue/10 bg-white px-5 py-5 sm:px-6"
            key={key}
          >
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-4 h-9 w-16" />
            <Skeleton className="mt-3 h-3 w-36" />
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

export function AdministrationPanelLoading({
  label,
}: {
  readonly label: string;
}) {
  return (
    <LoadingRegion label={`Loading ${label}`}>
      <div className="rounded-xl border border-navy-blue/10 bg-white p-5 sm:p-6">
        <Skeleton className="h-6 w-64 max-w-full" />
        <Skeleton className="mt-4 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-3/4" />
        <Skeleton className="mt-6 h-10 w-36" />
      </div>
    </LoadingRegion>
  );
}

export function AdministrationCollectionLoading({
  columns = 5,
  label,
  rows = 7,
}: {
  readonly columns?: number;
  readonly label: string;
  readonly rows?: number;
}) {
  return (
    <LoadingRegion label={`Loading ${label}`}>
      <AdministrationTableFrame>
        <div className="overflow-hidden p-4">
          <div
            className="grid gap-4 border-b border-navy-blue/10 pb-4"
            style={{
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            }}
          >
            {skeletonKeys("table-heading", columns).map((key) => (
              <Skeleton className="h-4 w-20 max-w-full" key={key} />
            ))}
          </div>
          <div className="divide-y divide-navy-blue/10">
            {skeletonKeys("table-row", rows).map((rowKey) => (
              <div
                className="grid gap-4 py-4"
                key={rowKey}
                style={{
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                }}
              >
                {skeletonKeys(`${rowKey}-cell`, columns).map(
                  (cellKey, columnIndex) => (
                    <Skeleton
                      className={columnIndex === 0 ? "h-4 w-28" : "h-4 w-20"}
                      key={cellKey}
                    />
                  )
                )}
              </div>
            ))}
          </div>
        </div>
      </AdministrationTableFrame>
    </LoadingRegion>
  );
}

export function AdministrationDetailLoading({
  label = "record details",
}: {
  readonly label?: string;
}) {
  return (
    <LoadingRegion label={`Loading ${label}`}>
      <div className="mb-7">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-8 w-72 max-w-full" />
        <Skeleton className="mt-3 h-4 w-[32rem] max-w-full" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <div className="rounded-xl border border-navy-blue/10 bg-white p-5 sm:p-6">
            <Skeleton className="h-6 w-40" />
            <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {skeletonKeys("detail-fact", 6).map((key) => (
                <div key={key}>
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="mt-2 h-4 w-28" />
                </div>
              ))}
            </div>
          </div>
          <AdministrationTableFrame>
            <div className="space-y-4 p-4">
              {skeletonKeys("detail-activity-row", 4).map((key) => (
                <Skeleton className="h-10 w-full" key={key} />
              ))}
            </div>
          </AdministrationTableFrame>
        </div>
        <div className="space-y-5">
          {skeletonKeys("detail-sidebar-card", 2).map((key) => (
            <div
              className="rounded-xl border border-navy-blue/10 bg-white p-5"
              key={key}
            >
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-4 h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-3/4" />
            </div>
          ))}
        </div>
      </div>
    </LoadingRegion>
  );
}

export function AdministrationRouteLoading() {
  return (
    <AdministrationPage>
      <AdministrationDetailLoading label="administration page" />
    </AdministrationPage>
  );
}

export function AdministrationModalLoading() {
  return (
    <output
      aria-busy="true"
      aria-label="Loading discount code form"
      className="fixed inset-0 z-50 grid place-items-center bg-navy-blue/35 p-4"
    >
      <div
        aria-hidden
        className="w-full max-w-4xl rounded-xl border border-navy-blue/10 bg-white p-6 shadow-xl"
      >
        <Skeleton className="h-7 w-72 max-w-full" />
        <Skeleton className="mt-3 h-4 w-[34rem] max-w-full" />
        <div className="mt-7 grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
        <Skeleton className="mt-6 h-10 w-full" />
        <div className="mt-7 flex justify-end gap-3">
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-44" />
        </div>
      </div>
    </output>
  );
}
