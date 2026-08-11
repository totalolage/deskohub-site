import { requireDotyposCustomerRouteId } from "@/features/administration/route-identifiers.server";
import { CustomerDiscountCodeCreationDialog } from "@/features/discounts/admin/customer-code-creation-dialog";
import { loadDiscountAdminCustomerCodeCreationPageData } from "@/features/discounts/admin/page-data.server";

export default async function CustomerDiscountCodeCreationModal({
  params,
}: {
  readonly params: Promise<{ readonly customerId: string }>;
}) {
  const { customerId } = await params;
  const { customer, discounts } =
    await loadDiscountAdminCustomerCodeCreationPageData(
      requireDotyposCustomerRouteId(customerId)
    );

  return (
    <CustomerDiscountCodeCreationDialog
      customerId={customer.id}
      customerName={customer.displayName}
      discounts={discounts}
    />
  );
}
