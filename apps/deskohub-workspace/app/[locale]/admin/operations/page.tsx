import { Suspense } from "react";
import {
  AdministrationAlert,
  AdministrationPage,
  AdministrationTableCount,
  AdministrationTableToolbar,
} from "@/features/administration/components";
import { OperationsAdministrationFilterForm } from "@/features/administration/filter-forms";
import { m } from "@/features/administration/i18n";
import {
  AdministrationCollectionLoading,
  AdministrationCountLoading,
  AdministrationFiltersLoading,
} from "@/features/administration/loading";
import {
  type AdministrationSearchParams,
  loadAdministrationOperationsPage,
} from "@/features/administration/page-data.server";
import { OperationTable } from "@/features/administration/payment-tables";
import type { Locale } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";

export default function OperationsAdministrationPage({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  return <OperationsAdministration searchParams={searchParams} />;
}

async function OperationsAdministration({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  const locale = await getRequestLocale();
  const { criteria, result } = loadAdministrationOperationsPage(searchParams);

  return (
    <AdministrationPage>
      <h1 className="sr-only">
        {m.administrationOperationListTitle({}, { locale })}
      </h1>
      <AdministrationTableToolbar
        count={
          <Suspense
            fallback={
              <AdministrationCountLoading
                label={m.administrationOperationCountLoading({}, { locale })}
              />
            }
          >
            <OperationCount locale={locale} result={result} />
          </Suspense>
        }
        filterLayout="inline"
        filters={
          <Suspense fallback={<AdministrationFiltersLoading fields={4} />}>
            <OperationFiltersContent criteria={criteria} />
          </Suspense>
        }
        label={m.administrationOperationTableControls({}, { locale })}
      />
      <Suspense
        fallback={
          <AdministrationCollectionLoading
            label={m.administrationOperationListLoading({}, { locale })}
            columns={6}
          />
        }
      >
        <OperationResultsContent locale={locale} result={result} />
      </Suspense>
    </AdministrationPage>
  );
}

type OperationsPage = ReturnType<typeof loadAdministrationOperationsPage>;
type OperationsResult = Awaited<OperationsPage["result"]>;
type OperationCriteria = Awaited<OperationsPage["criteria"]>;

async function OperationCount({
  locale,
  result,
}: {
  readonly locale: Locale;
  readonly result: Promise<OperationsResult>;
}) {
  const count = (await result).items.length;
  return (
    <AdministrationTableCount
      count={count}
      label={m.administrationOperationCount({ count }, { locale })}
    />
  );
}

async function OperationFiltersContent({
  criteria,
}: {
  readonly criteria: Promise<OperationCriteria>;
}) {
  return <OperationsAdministrationFilterForm query={await criteria} />;
}

async function OperationResultsContent({
  locale,
  result,
}: {
  readonly locale: Locale;
  readonly result: Promise<OperationsResult>;
}) {
  return <OperationResults locale={locale} result={await result} />;
}

function OperationResults({
  locale,
  result,
}: {
  readonly locale: Locale;
  readonly result: OperationsResult;
}) {
  return (
    <>
      {!result.providerAvailable && (
        <AdministrationAlert className="mb-5" status="warning">
          {m.administrationOperationListProviderUnavailable({}, { locale })}
        </AdministrationAlert>
      )}
      {result.truncated && (
        <p className="mb-4 text-sm text-navy-blue/65">
          {m.administrationOperationListTruncated({}, { locale })}
        </p>
      )}
      <OperationTable operations={result.items} />
    </>
  );
}
