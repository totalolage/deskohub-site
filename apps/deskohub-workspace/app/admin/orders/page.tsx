import {
  AdministrationPage,
  AdministrationPageHeader,
} from "@/features/administration/components";
import type { AdministrationSearchParams } from "@/features/administration/page-data.server";
import { loadAdministrationOrders } from "@/features/administration/page-data.server";
import { OrderTable } from "@/features/administration/payment-components";
import { Button } from "@/shared/components/ui/button";

export const dynamic = "force-dynamic";

export default async function OrdersAdministrationPage({
  searchParams,
}: {
  readonly searchParams: AdministrationSearchParams;
}) {
  const { range, result } = await loadAdministrationOrders(searchParams);
  return (
    <AdministrationPage>
      <AdministrationPageHeader
        count={result.items.length}
        description="Nexi orders reconciled with local payment attempts and their Workspace reservations."
        eyebrow="Payments"
        title="Orders"
      />
      <form className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-navy-blue/10 bg-white p-4">
        <DateField defaultValue={range.from} label="From" name="from" />
        <DateField defaultValue={range.to} label="To" name="to" />
        <Button
          className="bg-burned-orange-ink hover:bg-burned-orange-ink/90"
          size="sm"
          type="submit"
        >
          Show orders
        </Button>
      </form>
      {!result.providerAvailable && (
        <ProviderUnavailable message="Nexi is temporarily unavailable. Local orders are still shown, but provider-only orders and current status may be missing." />
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
    <label className="grid gap-1.5 text-sm font-semibold">
      {label}
      <input
        className="h-10 rounded-lg border border-navy-blue/15 bg-white px-3 text-sm outline-none focus:border-burned-orange focus:ring-2 focus:ring-burned-orange/15"
        defaultValue={defaultValue}
        name={name}
        type="date"
      />
    </label>
  );
}

function ProviderUnavailable({ message }: { readonly message: string }) {
  return (
    <p className="mb-5 rounded-xl border border-sunset-yellow/35 bg-sunset-yellow/10 px-4 py-3 text-sm">
      {message}
    </p>
  );
}
