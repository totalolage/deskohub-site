import { Suspense } from "react";
import { AdministrationModalLoading } from "@/features/administration/loading";
import { requireDotyposCustomerRouteId } from "@/features/administration/route-identifiers.server";
import { formatDiscountAdminCustomerName } from "@/features/discounts/admin/customer-display-name";
import { CustomerVoucherCreationDialog } from "@/features/discounts/admin/customer-voucher-creation";
import { loadDiscountAdminCustomerVoucherCreationPageData } from "@/features/discounts/admin/page-data.server";
import { getRequestLocale } from "@/features/i18n/server/request-locale";

export default function CustomerVoucherCreationModal({
  params,
}: {
  readonly params: Promise<{ readonly customerId: string }>;
}) {
  return (
    <Suspense fallback={<AdministrationModalLoading />}>
      <CustomerVoucherCreationModalContent params={params} />
    </Suspense>
  );
}

async function CustomerVoucherCreationModalContent({
  params,
}: {
  readonly params: Promise<{ readonly customerId: string }>;
}) {
  const locale = await getRequestLocale();
  const { customerId } = await params;
  const { customer } = await loadDiscountAdminCustomerVoucherCreationPageData(
    requireDotyposCustomerRouteId(customerId)
  );

  return (
    <CustomerVoucherCreationDialog
      customer={{
        displayName: formatDiscountAdminCustomerName(customer, locale),
        id: customer.id,
      }}
    />
  );
}
