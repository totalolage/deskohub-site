"use client";

import {
  type ColumnDef,
  createSortedRowModel,
  flexRender,
  metaHelper,
  type Row,
  type RowData,
  rowSortingFeature,
  type SortingState,
  sortFn_alphanumeric,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { type ReactNode, useState } from "react";
import { useRouteLocale } from "@/features/i18n/route-locale";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { cn } from "@/shared/utils";
import type { AdministrationHref } from "./administration-href";
import { m } from "./i18n";
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

type AdministrationDataTableRow<T extends RowData> = Row<
  typeof administrationTableFeatures,
  T
>;

const isTableRowControl = (target: EventTarget | null) =>
  target instanceof Element &&
  Boolean(target.closest("a, button, input, select, textarea, label, summary"));

const rowActivationKeys = new Set(["Enter", " "]);

/** Opens the row's detail when the table lets this row activate, else nothing. */
const getRowActivation = <T extends RowData>(
  item: T,
  expanded: boolean,
  onRowActivate: ((item: T, expanded: boolean) => void) | undefined,
  canRowActivate: ((item: T) => boolean) | undefined
) =>
  onRowActivate && (canRowActivate?.(item) ?? true)
    ? () => onRowActivate(item, expanded)
    : undefined;

/** A body row that, when it can activate, opens from a click outside its controls or Enter/Space on the row itself. */
function ActivatableTableRow({
  activate,
  children,
  expanded,
}: {
  readonly activate: (() => void) | undefined;
  readonly children: ReactNode;
  readonly expanded: boolean;
}) {
  const canActivate = activate !== undefined;
  return (
    <TableRow
      aria-expanded={canActivate ? expanded : undefined}
      className={cn(
        "relative",
        canActivate &&
          "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-burned-orange",
        expanded && "bg-navy-blue/[0.025]"
      )}
      onClick={(event) => {
        if (!activate || isTableRowControl(event.target)) {
          return;
        }
        activate();
      }}
      onKeyDown={(event) => {
        if (
          !activate ||
          event.target !== event.currentTarget ||
          !rowActivationKeys.has(event.key)
        ) {
          return;
        }
        event.preventDefault();
        activate();
      }}
      tabIndex={canActivate ? 0 : undefined}
    >
      {children}
    </TableRow>
  );
}

function AdministrationDataTableBodyRow<T extends RowData>({
  activate,
  expanded,
  renderActions,
  renderExpanded,
  row,
}: {
  readonly activate: (() => void) | undefined;
  readonly expanded: boolean;
  readonly renderActions?: (item: T, expanded: boolean) => ReactNode;
  readonly renderExpanded?: (item: T) => ReactNode;
  readonly row: AdministrationDataTableRow<T>;
}) {
  const cells = row.getAllCells();
  return (
    <>
      <ActivatableTableRow activate={activate} expanded={expanded}>
        {cells.map((cell) => (
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
      </ActivatableTableRow>
      {expanded && renderExpanded && (
        <TableRow className="bg-[#fafafd] hover:bg-[#fafafd]">
          <TableCell
            className="border-t border-navy-blue/10 p-5"
            colSpan={cells.length + (renderActions ? 1 : 0)}
          >
            {renderExpanded(row.original)}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export function AdministrationDataTable<T extends RowData>({
  actionsLabel,
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
  ) => AdministrationHref | undefined;
  readonly mobile?: ReactNode;
  readonly onRowActivate?: (item: T, expanded: boolean) => void;
  readonly renderActions?: (item: T, expanded: boolean) => ReactNode;
  readonly renderExpanded?: (item: T) => ReactNode;
  readonly sorting?: AdministrationDataTableSorting;
  readonly tableClassName?: string;
}) {
  const locale = useRouteLocale();
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
              <TableHead className="w-24 text-right">
                {actionsLabel ?? m.administrationTableActions({}, { locale })}
              </TableHead>
            )}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => {
          const expanded = row.id === expandedId;
          return (
            <AdministrationDataTableBodyRow
              activate={getRowActivation(
                row.original,
                expanded,
                onRowActivate,
                canRowActivate
              )}
              expanded={expanded}
              key={row.id}
              renderActions={renderActions}
              renderExpanded={renderExpanded}
              row={row}
            />
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
