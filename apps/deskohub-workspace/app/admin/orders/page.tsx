import { Suspense } from "react";
import {
  AdministrationAlert,
  AdministrationFilterField,
  AdministrationFilterForm,
  AdministrationFilterInput,
  AdministrationPage,
  AdministrationTableToolbar,
} from "@/features/administration/components";
import {
  AdministrationCollectionLoading,
  AdministrationCountLoading,
  AdministrationFiltersLoading,
} from "@/features/administration/loading";
import type { AdministrationSearchParams } from "@/features/administration/page-data.server";
import {
  type loadAdministrationOrders,
  loadAdministrationOrdersPage,
} from "@/features/administration/page-data.server";
import { OrderTable } from "@/features/administration/payment-components";
import { Button } from "@/shared/components/ui/button";

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
  return (await result).items.length;
}

async function OrderFiltersContent({
  range,
}: {
  readonly range: Promise<OrdersData["range"]>;
}) {
  return <OrderFilters range={await range} />;
}

async function OrderResultsContent({
  result,
}: {
  readonly result: Promise<OrdersData["result"]>;
}) {
  return <OrderResults result={await result} />;
}

function OrderFilters({ range }: { readonly range: OrdersData["range"] }) {
  return (
    <AdministrationFilterForm variant="standalone">
      <DateField defaultValue={range.from} label="From" name="from" />
      <DateField defaultValue={range.to} label="To" name="to" />
      <Button className="min-h-10" size="sm" type="submit">
        Show orders
      </Button>
    </AdministrationFilterForm>
  );
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

function DateField({
  defaultValue,
  label,
  name,
}: {
  readonly defaultValue: string;
  readonly label: string;
  readonly name: string;
}) {
  return (
    <AdministrationFilterField htmlFor={`order-${name}`} label={label}>
      <AdministrationFilterInput
        defaultValue={defaultValue}
        id={`order-${name}`}
        name={name}
        type="date"
      />
    </AdministrationFilterField>
  );
}
