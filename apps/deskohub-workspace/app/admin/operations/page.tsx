import {
  AdministrationAlert,
  AdministrationFilterField,
  AdministrationFilterForm,
  AdministrationFilterInput,
  AdministrationFilterSelect,
  AdministrationPage,
  AdministrationTableToolbar,
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
      <h1 className="sr-only">Operations</h1>
      <AdministrationTableToolbar
        count={result.items.length}
        filters={
          <AdministrationFilterForm variant="standalone">
            <FilterField
              defaultValue={range.from}
              label="From"
              name="from"
              type="date"
            />
            <FilterField
              defaultValue={range.to}
              label="To"
              name="to"
              type="date"
            />
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
            <Button className="min-h-10" size="sm" type="submit">
              Show operations
            </Button>
          </AdministrationFilterForm>
        }
        itemLabel="operation"
      />
      {!result.providerAvailable && (
        <AdministrationAlert className="mb-5" status="warning">
          Nexi operations are temporarily unavailable. No operation snapshot is
          persisted locally, so try again later.
        </AdministrationAlert>
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
    <AdministrationFilterField htmlFor={`operation-${name}`} label={label}>
      <AdministrationFilterInput
        defaultValue={defaultValue}
        id={`operation-${name}`}
        name={name}
        type={type}
      />
    </AdministrationFilterField>
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
    <AdministrationFilterField htmlFor={`operation-${name}`} label={label}>
      <AdministrationFilterSelect
        defaultValue={defaultValue ?? ""}
        id={`operation-${name}`}
        name={name}
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option.replaceAll("_", " ")}
          </option>
        ))}
      </AdministrationFilterSelect>
    </AdministrationFilterField>
  );
}
