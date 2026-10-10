"use client";

import {
  type ColumnDef,
  createSortedRowModel,
  flexRender,
  metaHelper,
  type RowData,
  rowSortingFeature,
  type SortingState,
  sortFn_alphanumeric,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { Fragment, type ReactNode, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { cn } from "@/shared/utils";
import { AdministrationSortHead } from "./sort-head";
import {
  AdministrationResponsiveTable,
  AdministrationTableFrame,
} from "./table-frame";

const administrationTableFeatures = tableFeatures({
  columnMeta: metaHelper<{
    readonly cellClassName?: string;
    readonly headClassName?: string;
  }>(),
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  // Automatic column sorting resolves these by name from the leading rows'
  // values; registering them keeps text and date columns naturally ordered.
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
});

export type AdministrationDataTableColumn<T extends RowData> = ColumnDef<
  typeof administrationTableFeatures,
  T
>;

export type AdministrationDataTableSorting = SortingState;

const isTableRowControl = (target: EventTarget | null) =>
  target instanceof Element &&
  Boolean(target.closest("a, button, input, select, textarea, label, summary"));

export function AdministrationDataTable<T extends RowData>({
  actionsLabel = "Actions",
  ariaLabel,
  canRowActivate,
  columns,
  data,
  expandedId,
  getRowId,
  getSortHref,
  mobile,
  onRowActivate,
  renderActions,
  renderExpanded,
  sorting: controlledSorting,
  tableClassName,
}: {
  readonly actionsLabel?: string;
  readonly ariaLabel: string;
  readonly canRowActivate?: (item: T) => boolean;
  readonly columns: readonly AdministrationDataTableColumn<T>[];
  readonly data: readonly T[];
  readonly expandedId?: string | null;
  readonly getRowId: (item: T, index: number) => string;
  readonly getSortHref?: (
    columnId: string,
    direction: "asc" | "desc"
  ) => string | undefined;
  readonly mobile?: ReactNode;
  readonly onRowActivate?: (item: T, expanded: boolean) => void;
  readonly renderActions?: (item: T, expanded: boolean) => ReactNode;
  readonly renderExpanded?: (item: T) => ReactNode;
  readonly sorting?: AdministrationDataTableSorting;
  readonly tableClassName?: string;
}) {
  const [sorting, setSorting] = useState<AdministrationDataTableSorting>([]);
  const table = useTable({
    columns,
    data,
    enableSortingRemoval: false,
    features: administrationTableFeatures,
    getRowId,
    manualSorting: Boolean(getSortHref),
    onSortingChange: setSorting,
    state: { sorting: controlledSorting ?? sorting },
  });

  const desktop = (
    <Table aria-label={ariaLabel} className={tableClassName}>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow className="hover:bg-transparent" key={headerGroup.id}>
            {headerGroup.headers.map((header) => {
              const sorted = header.column.getIsSorted();
              const canSort = header.column.getCanSort();
              return (
                <AdministrationSortHead
                  className={header.column.columnDef.meta?.headClassName}
                  direction={sorted}
                  href={
                    canSort && getSortHref
                      ? getSortHref(
                          header.column.id,
                          sorted === "asc" ? "desc" : "asc"
                        )
                      : undefined
                  }
                  key={header.id}
                  onToggle={
                    canSort && !getSortHref
                      ? header.column.getToggleSortingHandler()
                      : undefined
                  }
                >
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext()
                  )}
                </AdministrationSortHead>
              );
            })}
            {renderActions && (
              <TableHead className="w-24 text-right">{actionsLabel}</TableHead>
            )}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => {
          const expanded = row.id === expandedId;
          const rowCanActivate =
            Boolean(onRowActivate) && (canRowActivate?.(row.original) ?? true);
          return (
            <Fragment key={row.id}>
              <TableRow
                aria-expanded={rowCanActivate ? expanded : undefined}
                className={cn(
                  "relative",
                  rowCanActivate &&
                    "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-burned-orange",
                  expanded && "bg-navy-blue/[0.025]"
                )}
                onClick={(event) => {
                  if (!rowCanActivate || isTableRowControl(event.target)) {
                    return;
                  }
                  if (!onRowActivate) return;
                  onRowActivate(row.original, expanded);
                }}
                onKeyDown={(event) => {
                  if (
                    !rowCanActivate ||
                    event.target !== event.currentTarget ||
                    (event.key !== "Enter" && event.key !== " ")
                  ) {
                    return;
                  }
                  event.preventDefault();
                  onRowActivate?.(row.original, expanded);
                }}
                tabIndex={rowCanActivate ? 0 : undefined}
              >
                {row.getAllCells().map((cell) => (
                  <TableCell
                    className={cell.column.columnDef.meta?.cellClassName}
                    key={cell.id}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
                {renderActions && (
                  <TableCell className="text-right">
                    {renderActions(row.original, expanded)}
                  </TableCell>
                )}
              </TableRow>
              {expanded && renderExpanded && (
                <TableRow className="bg-[#fafafd] hover:bg-[#fafafd]">
                  <TableCell
                    className="border-t border-navy-blue/10 p-5"
                    colSpan={row.getAllCells().length + (renderActions ? 1 : 0)}
                  >
                    {renderExpanded(row.original)}
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );

  if (mobile) {
    return <AdministrationResponsiveTable desktop={desktop} mobile={mobile} />;
  }
  return <AdministrationTableFrame>{desktop}</AdministrationTableFrame>;
}
