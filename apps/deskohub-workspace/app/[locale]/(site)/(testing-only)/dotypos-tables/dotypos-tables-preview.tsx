"use client";

import type { Table } from "@deskohub/dotypos/generated";
import { TableMap } from "@deskohub/dotypos/table-map";
import { useState } from "react";

type DotyposTablesPreviewProps = {
  readonly tables: readonly Table[];
};

const getTableKey = (table: Table) => table.id ?? table.name;

const getTableClassName = (table: Table, selectedTable: Table | undefined) => {
  const selected =
    getTableKey(table) === (selectedTable && getTableKey(selectedTable));

  if (selected) {
    return "cursor-pointer fill-amber-300 stroke-amber-950 stroke-2 transition-colors";
  }

  if (table.enabled === false || table.display === false) {
    return "cursor-pointer fill-stone-200 stroke-stone-400 stroke-2 transition-colors hover:fill-stone-300";
  }

  return "cursor-pointer fill-emerald-300 stroke-emerald-900 stroke-2 transition-colors hover:fill-emerald-200";
};

export function DotyposTablesPreview({ tables }: DotyposTablesPreviewProps) {
  const [selectedTable, setSelectedTable] = useState<Table | undefined>(
    tables[0]
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="overflow-hidden rounded-3xl border border-stone-300 bg-white p-4 shadow-2xl shadow-black/10 [&>svg]:h-[70vh] [&>svg]:min-h-[420px] [&>svg]:w-full">
        <TableMap
          tables={tables}
          tableStyle={(table) => getTableClassName(table, selectedTable)}
          onTableClick={setSelectedTable}
        />
      </div>

      <aside className="rounded-3xl border border-stone-300 bg-white p-5 shadow-xl shadow-black/5">
        <h2 className="font-bold text-2xl text-[#00024f]">Selected table</h2>
        {selectedTable ? (
          <dl className="mt-5 grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-stone-500">Name</dt>
            <dd className="font-semibold">{selectedTable.name}</dd>
            <dt className="text-stone-500">ID</dt>
            <dd className="break-all">{selectedTable.id ?? "-"}</dd>
            <dt className="text-stone-500">Type</dt>
            <dd>{selectedTable.type ?? "GENERIC"}</dd>
            <dt className="text-stone-500">Location</dt>
            <dd>{selectedTable.locationName ?? "-"}</dd>
            <dt className="text-stone-500">Seats</dt>
            <dd>{selectedTable.seats ?? "-"}</dd>
            <dt className="text-stone-500">Position</dt>
            <dd>
              {selectedTable.positionX ?? "0"}, {selectedTable.positionY ?? "0"}
            </dd>
            <dt className="text-stone-500">Rotation</dt>
            <dd>{selectedTable.rotation ?? "0"}</dd>
            <dt className="text-stone-500">Visible</dt>
            <dd>{selectedTable.display === false ? "No" : "Yes"}</dd>
            <dt className="text-stone-500">Enabled</dt>
            <dd>{selectedTable.enabled === false ? "No" : "Yes"}</dd>
          </dl>
        ) : (
          <p className="mt-4 text-stone-600">No Dotypos tables loaded.</p>
        )}
      </aside>
    </div>
  );
}
