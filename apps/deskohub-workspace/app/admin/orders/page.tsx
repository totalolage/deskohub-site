import { Suspense } from "react";
import {
  AdministrationPage,
  AdministrationTableToolbar,
} from "@/features/administration/components";
import { AdministrationCollectionLoading } from "@/features/administration/loading";
import { OrderAdministrationTable } from "@/features/administration/order-administration-components";
import { loadAdministrationOrders } from "@/features/administration/page-data.server";

export default function OrdersAdministrationPage() {
  return (
    <AdministrationPage>
      <h1 className="sr-only">Orders</h1>
      <Suspense
        fallback={
          <AdministrationCollectionLoading label="orders" columns={6} />
        }
      >
        <OrdersAdministrationContent />
      </Suspense>
    </AdministrationPage>
  );
}

async function OrdersAdministrationContent() {
  const result = await loadAdministrationOrders();
  return (
    <>
      <AdministrationTableToolbar
        count={result.items.length}
        itemLabel="order"
      />
      {result.truncated && (
        <p className="mb-4 text-sm text-navy-blue/65">
          Showing the 50 most recently created orders.
        </p>
      )}
      <OrderAdministrationTable orders={result.items} />
    </>
  );
}
