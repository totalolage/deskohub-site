import {
  AdministrationAlert,
  AdministrationFilterField,
  AdministrationFilterForm,
  AdministrationFilterInput,
  AdministrationPage,
  AdministrationTableToolbar,
} from "@/features/administration/components";
import type { AdministrationSearchParams } from "@/features/administration/page-data.server";
import { loadAdministrationOrders } from "@/features/administration/page-data.server";
import { OrderTable } from "@/features/administration/payment-components";
import { Button } from "@/shared/components/ui/button";

export default async function OrdersAdministrationPage({
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
        filters={
          <AdministrationFilterForm variant="standalone">
            <DateField defaultValue={range.from} label="From" name="from" />
            <DateField defaultValue={range.to} label="To" name="to" />
            <Button className="min-h-10" size="sm" type="submit">
              Show orders
            </Button>
          </AdministrationFilterForm>
        }
        itemLabel="order"
      />
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
    </AdministrationPage>
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
