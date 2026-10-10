import { Suspense } from "react";
import {
  AdministrationAlert,
  AdministrationPage,
  AdministrationTableCount,
  AdministrationTableToolbar,
} from "@/features/administration/components";
import { OperationsAdministrationFilterForm } from "@/features/administration/filter-forms";
import {
  AdministrationCollectionLoading,
  AdministrationCountLoading,
  AdministrationFiltersLoading,
} from "@/features/administration/loading";
import {
  type AdministrationSearchParams,
  loadAdministrationOperations,
  loadAdministrationOperationsPage,
} from "@/features/administration/page-data.server";
import { OperationTable } from "@/features/administration/payment-tables";

export default function OperationsAdministrationPage({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  const { criteria, result } = loadAdministrationOperationsPage(searchParams);

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

type OperationsData = Awaited<ReturnType<typeof loadAdministrationOperations>>;
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
  return <OperationsAdministrationFilterForm {...(await criteria)} />;
}

async function OperationResultsContent({
  result,
}: {
  readonly result: Promise<OperationsData["result"]>;
}) {
  return <OperationResults result={await result} />;
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
      <OperationTable operations={result.items} />
    </>
  );
}

export async function OperationsAdministrationContent({
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
          <OperationsAdministrationFilterForm input={input} range={range} />
        }
        itemLabel="operation"
      />
      <OperationResults result={result} />
    </AdministrationPage>
  );
}
