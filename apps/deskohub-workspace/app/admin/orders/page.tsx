import { Suspense } from "react";
import {
  AdministrationAlert,
  AdministrationPage,
  AdministrationTableCount,
  AdministrationTableToolbar,
} from "@/features/administration/components";
import { OrdersAdministrationFilterForm } from "@/features/administration/filter-forms";
import {
  AdministrationCollectionLoading,
  AdministrationCountLoading,
  AdministrationFiltersLoading,
} from "@/features/administration/loading";
import {
  type AdministrationSearchParams,
  loadAdministrationOrders,
  loadAdministrationOrdersPage,
} from "@/features/administration/page-data.server";
import { OrderTable } from "@/features/administration/payment-tables";

export default function OrdersAdministrationPage({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  const { range, result } = loadAdministrationOrdersPage(searchParams);

  return (
    <AdministrationPage>
      <h1 className="sr-only">Orders</h1>
      <AdministrationTableToolbar
        count={
          <Suspense fallback={<AdministrationCountLoading label="order" />}>
            <OrderCount result={result} />
          </Suspense>
        }
        filters={
          <Suspense fallback={<AdministrationFiltersLoading fields={2} />}>
            <OrderFiltersContent range={range} />
          </Suspense>
        }
        itemLabel="order"
      />
      <Suspense
        fallback={
          <AdministrationCollectionLoading label="orders" columns={6} />
        }
      >
        <OrderResultsContent result={result} />
      </Suspense>
    </AdministrationPage>
  );
}

type OrdersData = Awaited<ReturnType<typeof loadAdministrationOrders>>;

async function OrderCount({
  result,
}: {
  readonly result: Promise<OrdersData["result"]>;
}) {
  return (
    <AdministrationTableCount
      count={(await result).items.length}
      itemLabel="order"
    />
  );
}

async function OrderFiltersContent({
  range,
}: {
  readonly range: Promise<OrdersData["range"]>;
}) {
  return <OrdersAdministrationFilterForm range={await range} />;
}

async function OrderResultsContent({
  result,
}: {
  readonly result: Promise<OrdersData["result"]>;
}) {
  return <OrderResults result={await result} />;
}

function OrderResults({ result }: { readonly result: OrdersData["result"] }) {
  return (
    <>
      {!result.providerAvailable && (
        <AdministrationAlert className="mb-5" status="warning">
          Nexi is temporarily unavailable. Local orders are still shown, but
          provider-only orders and current status may be missing.
        </AdministrationAlert>
      )}
      {result.truncated && (
        <p className="mb-4 text-sm text-navy-blue/65">
          Showing the first matching records. Narrow the date range to inspect
          older activity.
        </p>
      )}
      <OrderTable orders={result.items} />
    </>
  );
}

export async function OrdersAdministrationContent({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  const { range, result } = await loadAdministrationOrders(searchParams);
  return (
    <AdministrationPage>
      <h1 className="sr-only">Orders</h1>
      <AdministrationTableToolbar
        count={result.items.length}
        filters={<OrdersAdministrationFilterForm range={range} />}
        itemLabel="order"
      />
      <OrderResults result={result} />
    </AdministrationPage>
  );
}
