import { Suspense } from "react";
import {
  AdministrationAlert,
  AdministrationFilterField,
  AdministrationFilterForm,
  AdministrationFilterInput,
  AdministrationFilterSelect,
  AdministrationPage,
  AdministrationTableCount,
  AdministrationTableToolbar,
} from "@/features/administration/components";
import {
  AdministrationCollectionLoading,
  AdministrationCountLoading,
  AdministrationFiltersLoading,
} from "@/features/administration/loading";
import {
  type AdministrationSearchParams,
  type loadAdministrationNexiOperations,
  loadAdministrationNexiOperationsPage,
} from "@/features/administration/page-data.server";
import {
  nexiOperationChannels,
  nexiOperationTypes,
} from "@/features/administration/payment-administration-filters";
import { NexiOperationTable } from "@/features/administration/payment-tables";
import { Button } from "@/shared/components/ui/button";

export default function NexiOperationsAdministrationPage({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  const { criteria, result } =
    loadAdministrationNexiOperationsPage(searchParams);

  return (
    <AdministrationPage>
      <h1 className="sr-only">Operations</h1>
      <AdministrationTableToolbar
        count={
          <Suspense fallback={<AdministrationCountLoading label="operation" />}>
            <OperationCount result={result} />
          </Suspense>
        }
        filters={
          <Suspense fallback={<AdministrationFiltersLoading fields={4} />}>
            <OperationFiltersContent criteria={criteria} />
          </Suspense>
        }
        itemLabel="operation"
      />
      <Suspense
        fallback={
          <AdministrationCollectionLoading label="operations" columns={6} />
        }
      >
        <OperationResultsContent result={result} />
      </Suspense>
    </AdministrationPage>
  );
}

type OperationsData = Awaited<
  ReturnType<typeof loadAdministrationNexiOperations>
>;
type OperationCriteria = Pick<OperationsData, "input" | "range">;

async function OperationCount({
  result,
}: {
  readonly result: Promise<OperationsData["result"]>;
}) {
  return (
    <AdministrationTableCount
      count={(await result).items.length}
      itemLabel="operation"
    />
  );
}

async function OperationFiltersContent({
  criteria,
}: {
  readonly criteria: Promise<OperationCriteria>;
}) {
  return <OperationFilters {...(await criteria)} />;
}

async function OperationResultsContent({
  result,
}: {
  readonly result: Promise<OperationsData["result"]>;
}) {
  return <OperationResults result={await result} />;
}

function OperationFilters({ input, range }: OperationCriteria) {
  return (
    <AdministrationFilterForm variant="standalone">
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
      <Button className="min-h-10" size="sm" type="submit">
        Show operations
      </Button>
    </AdministrationFilterForm>
  );
}

function OperationResults({
  result,
}: {
  readonly result: OperationsData["result"];
}) {
  return (
    <>
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
      <NexiOperationTable operations={result.items} />
    </>
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
