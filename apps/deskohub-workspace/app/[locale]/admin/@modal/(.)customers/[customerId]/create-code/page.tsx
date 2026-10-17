import { Suspense } from "react";
import { AdministrationModalLoading } from "@/features/administration/loading";
import { requireDotyposCustomerRouteId } from "@/features/administration/route-identifiers.server";
import { CustomerDiscountCodeCreationDialog } from "@/features/discounts/admin/customer-code-creation-dialog";
import { formatDiscountAdminCustomerName } from "@/features/discounts/admin/customer-display-name";
import { loadDiscountAdminCustomerCodeCreationPageData } from "@/features/discounts/admin/page-data.server";
import { getRequestLocale } from "@/features/i18n/server/request-locale";

export default function CustomerDiscountCodeCreationModal({
  params,
}: {
  readonly params: Promise<{ readonly customerId: string }>;
}) {
  return (
    <Suspense fallback={<AdministrationModalLoading />}>
      <CustomerDiscountCodeCreationModalContent params={params} />
    </Suspense>
  );
}

async function CustomerDiscountCodeCreationModalContent({
  params,
}: {
  readonly params: Promise<{ readonly customerId: string }>;
}) {
  const locale = await getRequestLocale();
  const { customerId } = await params;
  const { customer, discounts } =
    await loadDiscountAdminCustomerCodeCreationPageData(
      requireDotyposCustomerRouteId(customerId)
    );

  return (
    <CustomerDiscountCodeCreationDialog
      customerId={customer.id}
      customerName={formatDiscountAdminCustomerName(customer, locale)}
      discounts={discounts}
    />
  );
}
