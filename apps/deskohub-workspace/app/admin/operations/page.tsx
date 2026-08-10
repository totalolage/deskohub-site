import {
  AdministrationPage,
  AdministrationPageHeader,
} from "@/features/administration/components";
import {
  type AdministrationSearchParams,
  loadAdministrationOperations,
} from "@/features/administration/page-data.server";
import {
  nexiOperationChannels,
  nexiOperationTypes,
} from "@/features/administration/payment-administration-filters";
import { OperationTable } from "@/features/administration/payment-components";
import { Button } from "@/shared/components/ui/button";

export default async function OperationsAdministrationPage({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  const { input, range, result } =
    await loadAdministrationOperations(searchParams);
  return (
    <AdministrationPage>
      <AdministrationPageHeader
        count={result.items.length}
        description="Live Nexi payment operations linked back to their orders and Workspace reservations."
        eyebrow="Payments"
        title="Operations"
      />
      <form className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-navy-blue/10 bg-white p-4">
        <FilterField
          defaultValue={range.from}
          label="From"
          name="from"
          type="date"
        />
        <FilterField defaultValue={range.to} label="To" name="to" type="date" />
        <SelectField
          defaultValue={input.channel}
          label="Origin"
          name="channel"
          options={nexiOperationChannels}
        />
        <SelectField
          defaultValue={input.operationType}
          label="Type"
          name="operationType"
          options={nexiOperationTypes}
        />
        <Button
          className="bg-burned-orange-ink hover:bg-burned-orange-ink/90"
          size="sm"
          type="submit"
        >
          Show operations
        </Button>
      </form>
      {!result.providerAvailable && (
        <p className="mb-5 rounded-xl border border-sunset-yellow/35 bg-sunset-yellow/10 px-4 py-3 text-sm">
          Nexi operations are temporarily unavailable. No operation snapshot is
          persisted locally, so try again later.
        </p>
      )}
      {result.truncated && (
        <p className="mb-4 text-sm text-navy-blue/65">
          Showing the first 100 matching operations. Narrow the filters to see a
          smaller interval.
        </p>
      )}
      <OperationTable operations={result.items} />
    </AdministrationPage>
  );
}

function FilterField({
  defaultValue,
  label,
  name,
  type,
}: {
  readonly defaultValue?: string;
  readonly label: string;
  readonly name: string;
  readonly type: "date";
}) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold">
      {label}
      <input
        className="h-10 rounded-lg border border-navy-blue/15 bg-white px-3 text-sm outline-none focus:border-burned-orange focus:ring-2 focus:ring-burned-orange/15"
        defaultValue={defaultValue}
        name={name}
        type={type}
      />
    </label>
  );
}

function SelectField({
  defaultValue,
  label,
  name,
  options,
}: {
  readonly defaultValue?: string;
  readonly label: string;
  readonly name: string;
  readonly options: readonly string[];
}) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold">
      {label}
      <select
        className="h-10 rounded-lg border border-navy-blue/15 bg-white px-3 text-sm outline-none focus:border-burned-orange focus:ring-2 focus:ring-burned-orange/15"
        defaultValue={defaultValue ?? ""}
        name={name}
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option.replaceAll("_", " ")}
          </option>
        ))}
      </select>
    </label>
  );
}
